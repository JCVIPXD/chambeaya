import 'dart:convert';

import 'api_client.dart';
import 'jobs_models.dart';

/// Acceso del trabajador a los puestos fijos y a sus postulaciones. La
/// interfaz permite simular la API en las pruebas; [HttpJobsRepository] es la
/// implementación real (`/api/workers/job-postings` y
/// `/api/workers/job-applications`).
abstract interface class JobsRepository {
  Future<PagedResult<JobPosting>> searchPostings(
    JobSearchFilter filter, {
    String? cursor,
    int limit,
  });

  Future<JobPosting> posting(String id);

  /// Postula (o re-postula tras retirarse). Es idempotente en el servidor:
  /// repetir la misma petición nunca cobra dos veces.
  Future<ApplyResult> apply(
    String postingId, {
    List<ScreeningAnswer> answers,
    bool priority,
  });

  Future<PagedResult<JobApplication>> myApplications({
    bool history,
    ApplicationStatus? status,
    String? cursor,
    int limit,
  });

  Future<JobApplication> application(String id);
  Future<JobApplication> withdraw(String applicationId);
  Future<JobApplication> prioritize(String applicationId);
  Future<JobApplication> acceptOffer(String applicationId, String offerId);
  Future<JobApplication> declineOffer(String applicationId, String offerId);

  /// PDF de una oferta propia, ya validado como PDF.
  Future<OfferPdf> offerDocument(
    String applicationId,
    String offerId, {
    required String fallbackName,
  });
}

class HttpJobsRepository implements JobsRepository {
  HttpJobsRepository({required this.api});

  final ApiClient api;

  /// Tope razonable para un PDF de oferta (la API limita a 5 MB al subirlo).
  static const maxPdfBytes = 8 * 1024 * 1024;

  static String _segment(String value) => Uri.encodeComponent(value);

  @override
  Future<PagedResult<JobPosting>> searchPostings(
    JobSearchFilter filter, {
    String? cursor,
    int limit = 20,
  }) async {
    final json = await api.getJson(
      '/workers/job-postings',
      query: {
        ...filter.toQuery(),
        'limit': '$limit',
        'cursor': ?cursor,
      },
    );
    return _page(json, JobPosting.fromJson);
  }

  @override
  Future<JobPosting> posting(String id) async => JobPosting.fromJson(
    await api.getJson('/workers/job-postings/${_segment(id)}'),
  );

  @override
  Future<ApplyResult> apply(
    String postingId, {
    List<ScreeningAnswer> answers = const [],
    bool priority = false,
  }) async => ApplyResult.fromJson(
    await api.postJson(
      '/workers/job-postings/${_segment(postingId)}/applications',
      body: {
        'answers': answers.map((answer) => answer.toJson()).toList(),
        if (priority) 'priority': true,
      },
    ),
  );

  @override
  Future<PagedResult<JobApplication>> myApplications({
    bool history = false,
    ApplicationStatus? status,
    String? cursor,
    int limit = 20,
  }) async {
    final json = await api.getJson(
      '/workers/job-applications',
      query: {
        'limit': '$limit',
        if (history) 'history': 'true',
        if (status != null) 'status': status.apiValue,
        'cursor': ?cursor,
      },
    );
    return _page(json, JobApplication.fromJson);
  }

  @override
  Future<JobApplication> application(String id) async =>
      JobApplication.fromJson(
        await api.getJson('/workers/job-applications/${_segment(id)}'),
      );

  @override
  Future<JobApplication> withdraw(String applicationId) async =>
      JobApplication.fromJson(
        await api.postJson(
          '/workers/job-applications/${_segment(applicationId)}/withdraw',
        ),
      );

  @override
  Future<JobApplication> prioritize(String applicationId) async =>
      JobApplication.fromJson(
        await api.postJson(
          '/workers/job-applications/${_segment(applicationId)}/priority',
        ),
      );

  @override
  Future<JobApplication> acceptOffer(
    String applicationId,
    String offerId,
  ) async => JobApplication.fromJson(
    await api.postJson(
      '/workers/job-applications/${_segment(applicationId)}'
      '/offers/${_segment(offerId)}/accept',
    ),
  );

  @override
  Future<JobApplication> declineOffer(
    String applicationId,
    String offerId,
  ) async => JobApplication.fromJson(
    await api.postJson(
      '/workers/job-applications/${_segment(applicationId)}'
      '/offers/${_segment(offerId)}/decline',
    ),
  );

  @override
  Future<OfferPdf> offerDocument(
    String applicationId,
    String offerId, {
    required String fallbackName,
  }) async {
    final response = await api.getBytes(
      '/workers/job-applications/${_segment(applicationId)}'
      '/offers/${_segment(offerId)}/document',
    );
    if (response.statusCode != 200) throw ApiClient.errorFrom(response);
    final bytes = response.bodyBytes;
    final type = (response.headers['content-type'] ?? '').toLowerCase();
    final looksLikePdf =
        bytes.length >= 5 && ascii.decode(bytes.sublist(0, 5), allowInvalid: true) == '%PDF-';
    if (!type.startsWith('application/pdf') ||
        !looksLikePdf ||
        bytes.length > maxPdfBytes) {
      throw const ApiException(502, 'INVALID_PDF_RESPONSE');
    }
    return OfferPdf(fileName: fallbackName, bytes: bytes);
  }

  PagedResult<T> _page<T>(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) parse,
  ) {
    final items = json['items'];
    final cursor = json['nextCursor'];
    return PagedResult(
      items: (items is List ? items : const [])
          .whereType<Map>()
          .map((value) => parse(Map<String, dynamic>.from(value)))
          .toList(growable: false),
      nextCursor: cursor is String && cursor.isNotEmpty ? cursor : null,
    );
  }
}
