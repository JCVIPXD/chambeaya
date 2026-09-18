import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../core/config/app_config.dart';

/// A shift summary attached to an invitation, exactly the shape the server
/// returns from `POST/GET /api/workers/me/talent-invitations*`
/// (`talent_invitation.service.ts`, `shiftSummary`). `null` when the
/// invitation was not tied to a specific shift.
class InvitationShift {
  const InvitationShift({
    required this.id,
    required this.title,
    required this.startsAt,
    required this.endsAt,
  });

  final String id;
  final String title;
  final DateTime startsAt;
  final DateTime endsAt;

  factory InvitationShift.fromJson(Map<String, dynamic> json) =>
      InvitationShift(
        id: json['id'] as String,
        title: json['title'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String),
        endsAt: DateTime.parse(json['endsAt'] as String),
      );
}

/// An invitation a company sent to this worker's talent profile
/// (`TalentInvitation`, seen from the `WORKER` side: `toWorkerInvitation` in
/// `talent_invitation.service.ts`). Only the fields the server actually
/// returns are modeled here; the worker's own `userId` is never part of this
/// payload, and neither is the company's, beyond `companyId`/`companyName`.
class TalentInvitation {
  const TalentInvitation({
    required this.id,
    required this.status,
    required this.message,
    required this.expiresAt,
    required this.respondedAt,
    required this.createdAt,
    required this.shift,
    required this.companyId,
    required this.companyName,
  });

  final String id;

  /// Raw server status: `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED` or
  /// `CANCELLED`. Kept as the server's own string instead of a client enum
  /// so an unrecognized future value degrades to "unknown" text instead of
  /// throwing.
  final String status;
  final String? message;
  final DateTime expiresAt;
  final DateTime? respondedAt;
  final DateTime createdAt;
  final InvitationShift? shift;
  final String companyId;
  final String companyName;

  /// The server is always the final authority on whether a response is
  /// accepted (see `respond` in `talent_invitation.service.ts`, which
  /// re-checks status and expiration on every accept/decline). This is only
  /// a client-side guard so the UI never offers "Aceptar"/"Rechazar" on a
  /// card that could not possibly succeed, per the invitation's own
  /// already-known state.
  bool get isRespondable =>
      status == 'PENDING' && expiresAt.isAfter(DateTime.now());

  factory TalentInvitation.fromJson(Map<String, dynamic> json) =>
      TalentInvitation(
        id: json['id'] as String,
        status: json['status'] as String,
        message: json['message'] as String?,
        expiresAt: DateTime.parse(json['expiresAt'] as String),
        respondedAt: json['respondedAt'] == null
            ? null
            : DateTime.parse(json['respondedAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
        shift: json['shift'] is Map<String, dynamic>
            ? InvitationShift.fromJson(json['shift'] as Map<String, dynamic>)
            : null,
        companyId: json['companyId'] as String,
        companyName: json['companyName'] as String,
      );
}

/// Raised when the server rejects an accept/decline with a specific error
/// code (`TalentInvitationErrorCode` in `talent.routes.ts`), so the UI can
/// show a message that matches the real reason instead of a generic one.
class TalentInvitationResponseError implements Exception {
  const TalentInvitationResponseError(this.code);
  final String? code;

  @override
  String toString() => 'TalentInvitationResponseError($code)';
}

abstract interface class TalentInvitationRepository {
  /// Lists invitations addressed to the authenticated worker
  /// (`GET /api/workers/me/talent-invitations`). Ordered newest first by
  /// the server.
  Future<List<TalentInvitation>> list();

  /// Accepts a `PENDING` invitation
  /// (`POST /api/workers/me/talent-invitations/:id/accept`). Returns the
  /// invitation exactly as the server now sees it.
  Future<TalentInvitation> accept(String id);

  /// Declines a `PENDING` invitation
  /// (`POST /api/workers/me/talent-invitations/:id/decline`).
  Future<TalentInvitation> decline(String id);
}

class HttpTalentInvitationRepository implements TalentInvitationRepository {
  HttpTalentInvitationRepository({
    http.Client? client,
    Uri? baseUri,
    this.token,
  }) : _client = client ?? http.Client(),
       _baseUri = baseUri ?? Uri.parse(AppConfig.apiBaseUrl);

  final http.Client _client;
  final Uri _baseUri;
  final String? token;

  Map<String, String> get _headers =>
      token == null ? const {} : {'Authorization': 'Bearer $token'};

  @override
  Future<List<TalentInvitation>> list() async {
    final response = await _client
        .get(
          _baseUri.resolve('/api/workers/me/talent-invitations'),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw StateError('No se pudieron cargar tus invitaciones');
    }
    return (jsonDecode(response.body) as List<dynamic>)
        .map(
          (value) => TalentInvitation.fromJson(value as Map<String, dynamic>),
        )
        .toList(growable: false);
  }

  @override
  Future<TalentInvitation> accept(String id) => _respond(id, 'accept');

  @override
  Future<TalentInvitation> decline(String id) => _respond(id, 'decline');

  Future<TalentInvitation> _respond(String id, String action) async {
    final response = await _client
        .post(
          _baseUri.resolve('/api/workers/me/talent-invitations/$id/$action'),
          headers: _headers,
        )
        .timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) {
      throw TalentInvitationResponseError(_errorCode(response.body));
    }
    return TalentInvitation.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  String? _errorCode(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic> && decoded['error'] is String) {
        return decoded['error'] as String;
      }
    } catch (_) {
      // A non-JSON body just means we cannot attach a specific code; the
      // caller falls back to a generic message.
    }
    return null;
  }
}

/// Client-only demo repository (`CHAMBEAYA_DEMO_MODE=true`, no server). It
/// seeds a single `PENDING` invitation so the screen is not permanently
/// empty during a walkthrough, and lets it actually be accepted or declined
/// in memory, consistent with the rest of the demo repositories in this app.
class DemoTalentInvitationRepository implements TalentInvitationRepository {
  DemoTalentInvitationRepository()
    : _invitations = [
        TalentInvitation(
          id: 'demo-invitation-la-mar',
          status: 'PENDING',
          message:
              'Nos gustaría contar contigo para el turno de este fin de semana.',
          expiresAt: DateTime.now().add(const Duration(days: 7)),
          respondedAt: null,
          createdAt: DateTime.now().subtract(const Duration(days: 1)),
          shift: InvitationShift(
            id: 'shift-la-mar',
            title: 'Mozo de Salón',
            startsAt: DateTime.now().add(const Duration(days: 3)),
            endsAt: DateTime.now().add(const Duration(days: 3, hours: 6)),
          ),
          companyId: 'demo-company-la-mar',
          companyName: 'Restaurante La Mar',
        ),
      ];

  final List<TalentInvitation> _invitations;

  @override
  Future<List<TalentInvitation>> list() async =>
      List.unmodifiable(_invitations);

  @override
  Future<TalentInvitation> accept(String id) => _respond(id, 'ACCEPTED');

  @override
  Future<TalentInvitation> decline(String id) => _respond(id, 'DECLINED');

  Future<TalentInvitation> _respond(String id, String nextStatus) async {
    final index = _invitations.indexWhere((invitation) => invitation.id == id);
    if (index == -1) {
      throw const TalentInvitationResponseError('INVITATION_NOT_FOUND');
    }
    final current = _invitations[index];
    if (!current.isRespondable) {
      throw TalentInvitationResponseError(
        current.status == 'PENDING'
            ? 'INVITATION_EXPIRED'
            : 'INVITATION_NOT_PENDING',
      );
    }
    final updated = TalentInvitation(
      id: current.id,
      status: nextStatus,
      message: current.message,
      expiresAt: current.expiresAt,
      respondedAt: DateTime.now(),
      createdAt: current.createdAt,
      shift: current.shift,
      companyId: current.companyId,
      companyName: current.companyName,
    );
    _invitations[index] = updated;
    return updated;
  }
}
