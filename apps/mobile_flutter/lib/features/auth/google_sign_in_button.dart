import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'google_sign_in_button_platform.dart' as platform;

class GoogleSignInButton extends StatefulWidget {
  const GoogleSignInButton({
    required this.clientId,
    required this.onIdToken,
    required this.onFailure,
    this.enabled = true,
    super.key,
  });

  final String clientId;
  final ValueChanged<String> onIdToken;
  final ValueChanged<String> onFailure;
  final bool enabled;

  @override
  State<GoogleSignInButton> createState() => _GoogleSignInButtonState();
}

class _GoogleSignInButtonState extends State<GoogleSignInButton> {
  static Future<void>? _initialization;
  StreamSubscription<GoogleSignInAuthenticationEvent>? _events;
  var _ready = false;
  String? _lastDeliveredToken;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      _initialization ??= GoogleSignIn.instance.initialize(
        clientId: widget.clientId,
      );
      await _initialization;
      _events = GoogleSignIn.instance.authenticationEvents.listen(
        _onAuthenticationEvent,
        onError: (_, _) => widget.onFailure(
          'No se pudo completar el acceso con Google. Inténtalo nuevamente.',
        ),
      );
      if (mounted) setState(() => _ready = true);
    } catch (_) {
      if (mounted) {
        widget.onFailure(
          'Google no pudo inicializarse. Revisa el ID de cliente y el origen autorizado.',
        );
      }
    }
  }

  void _onAuthenticationEvent(GoogleSignInAuthenticationEvent event) {
    if (event is! GoogleSignInAuthenticationEventSignIn) return;
    final idToken = event.user.authentication.idToken;
    if (idToken == null || idToken.isEmpty) {
      widget.onFailure('Google no entregó un token de identidad válido.');
      return;
    }
    _deliver(idToken);
  }

  void _deliver(String idToken) {
    if (_lastDeliveredToken == idToken) return;
    _lastDeliveredToken = idToken;
    widget.onIdToken(idToken);
  }

  Future<void> _authenticateOnNative() async {
    if (!_ready || !widget.enabled) return;
    try {
      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken != null && idToken.isNotEmpty) _deliver(idToken);
    } catch (_) {
      widget.onFailure('No se pudo completar el acceso con Google.');
    }
  }

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const SizedBox(
        height: 42,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (!widget.enabled) {
      return const Text(
        'Ingresa tu DNI para continuar con Google.',
        style: TextStyle(color: Color(0xFF718096), fontSize: 12),
      );
    }
    return platform.buildGoogleButton(onPressed: _authenticateOnNative);
  }
}
