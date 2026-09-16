import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../onboarding/onboarding_page.dart';
import 'auth_repository.dart';
import 'auth_session.dart';
import 'google_sign_in_button.dart';

class AuthPage extends StatefulWidget {
  const AuthPage({
    super.key,
    required this.role,
    this.demoMode = false,
    this.repository,
    this.onAuthenticated,
    this.initialGooglePasswordSetupSession,
  });
  final AppAudience role;
  final bool demoMode;
  final AuthRepository? repository;
  final Future<void> Function(AuthSession session)? onAuthenticated;
  final AuthSession? initialGooglePasswordSetupSession;

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _identifier = TextEditingController();
  // Existing workers should be able to access the app immediately. Registration
  // remains available through the explicit toggle below.
  var _isRegistering = false;
  var _isLoading = false;
  String? _error;
  String? _pendingGoogleProfileSetupToken;
  AuthSession? _pendingGooglePasswordSession;

  bool get _canRegister => widget.role == AppAudience.worker;
  static const _googleClientId = String.fromEnvironment(
    'GOOGLE_OAUTH_WEB_CLIENT_ID',
  );
  bool get _googleEnabled =>
      !widget.demoMode && _canRegister && _googleClientId.isNotEmpty;
  bool get _isCompletingGoogleProfile =>
      _pendingGoogleProfileSetupToken != null;
  bool get _isCompletingGooglePassword =>
      _pendingGooglePasswordSession != null;
  bool get _isInGoogleOnboarding =>
      _isCompletingGoogleProfile || _isCompletingGooglePassword;

  @override
  void initState() {
    super.initState();
    _pendingGooglePasswordSession = widget.initialGooglePasswordSetupSession;
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _identifier.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_isInGoogleOnboarding) {
      await _completeGoogleProfile();
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    if (widget.demoMode) {
      await widget.onAuthenticated?.call(
        AuthSession(
          token: 'demo-${widget.role.name}',
          audience: widget.role,
          name: _isRegistering && _name.text.trim().isNotEmpty
              ? _name.text.trim()
              : 'Cuenta demo',
        ),
      );
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final repository = widget.repository ?? AuthRepository();
      final session = _isRegistering
          ? await repository.register(
              name: _name.text,
              email: _email.text,
              password: _password.text,
              identifier: _identifier.text,
            )
          : await repository.login(
              email: _email.text,
              password: _password.text,
            );
      if (mounted) await widget.onAuthenticated?.call(session);
    } on AuthFailure catch (failure) {
      if (mounted) {
        setState(() => _error = _messageForFailure(failure));
      }
    } catch (_) {
      if (mounted)
        setState(
          () =>
              _error = 'No se pudo completar el acceso. Inténtalo nuevamente.',
        );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _signInWithGoogle(String idToken) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final repository = widget.repository ?? AuthRepository();
      final result = await repository.startGoogleLogin(idToken: idToken);
      if (!mounted) return;
      if (result.session != null) {
        if (result.session!.requiresPasswordSetup) {
          setState(() {
            _pendingGooglePasswordSession = result.session;
            _password.clear();
            _error = null;
          });
        } else {
          await widget.onAuthenticated?.call(result.session!);
        }
      } else if (result.profileSetupToken != null) {
        setState(() {
          _pendingGoogleProfileSetupToken = result.profileSetupToken;
          _error = null;
        });
      } else {
        setState(() => _error = 'No se pudo preparar el perfil con Google.');
      }
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _messageForFailure(failure));
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'No se pudo validar la cuenta de Google.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _completeGoogleProfile() async {
    final dni = _identifier.text.trim();
    if (_isCompletingGoogleProfile && !RegExp(r'^\d{8}$').hasMatch(dni)) {
      setState(
        () => _error = 'Ingresa un DNI de 8 dígitos para continuar con Google.',
      );
      return;
    }
    if (!_isValidPassword(_password.text)) {
      setState(
        () => _error =
            'Crea una contraseña de Cumple Now con 8 caracteres, una mayúscula y un número.',
      );
      return;
    }
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final repository = widget.repository ?? AuthRepository();
      final session = _isCompletingGoogleProfile
          ? await repository.completeGoogleProfile(
              profileSetupToken: _pendingGoogleProfileSetupToken!,
              dni: dni,
              password: _password.text,
            )
          : await repository.setInitialGooglePassword(
              token: _pendingGooglePasswordSession!.token,
              password: _password.text,
            );
      if (mounted) {
        await widget.onAuthenticated?.call(
          session.copyWith(openProfileAfterSignIn: true),
        );
      }
    } on AuthFailure catch (failure) {
      if (mounted) setState(() => _error = _messageForFailure(failure));
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'No se pudo validar la cuenta de Google.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  bool _isValidPassword(String password) =>
      password.length >= 8 &&
      RegExp(r'[A-Z]').hasMatch(password) &&
      RegExp(r'\d').hasMatch(password);

  String _messageForFailure(AuthFailure failure) {
    if (_isRegistering && failure.code == 'DUPLICATE_ACCOUNT') {
      return 'Ya existe una cuenta con ese correo. Inicia sesión o usa otro correo.';
    }
    if (_isRegistering && failure.code == 'INVALID_REGISTRATION') {
      return 'Revisa nombre, correo, contraseña y DNI: deben cumplir los requisitos indicados.';
    }
    if (failure.code == 'DUPLICATE_IDENTIFIER') {
      return 'Ese DNI ya está asociado a otra cuenta. Usa un DNI distinto o inicia sesión.';
    }
    if (failure.code == 'GOOGLE_EMAIL_ALREADY_REGISTERED') {
      return 'Ese correo ya usa una cuenta con contraseña. Inicia sesión con ella.';
    }
    if (failure.code == 'GOOGLE_SIGN_IN_UNAVAILABLE') {
      return 'Google aún no está habilitado en este entorno.';
    }
    if (failure.code == 'GOOGLE_PROFILE_SETUP_EXPIRED') {
      return 'La verificación de Google venció. Elige tu cuenta nuevamente.';
    }
    switch (failure.kind) {
      case AuthFailureKind.invalidCredentials:
        return 'Correo o contraseña incorrectos. Revisa tus datos e inténtalo nuevamente.';
      case AuthFailureKind.connectivity:
        return 'No se pudo conectar con el servicio. Comprueba tu conexión e inténtalo nuevamente.';
      case AuthFailureKind.validation:
        return 'Revisa los datos ingresados e inténtalo nuevamente.';
      case AuthFailureKind.server:
        return 'El servicio no está disponible temporalmente. Inténtalo más tarde.';
      case AuthFailureKind.unknown:
        return 'No se pudo completar el acceso. Inténtalo nuevamente.';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isRegistering ? 'Crea tu cuenta' : 'Inicia sesión'),
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final isWide = constraints.maxWidth >= 820;
            final intro = _buildIntro(context, compact: !isWide);
            final form = _buildFormCard(context, compact: !isWide);

            if (isWide) {
              return Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1120),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 40,
                      vertical: 28,
                    ),
                    child: Row(
                      children: [
                        Expanded(child: intro),
                        const SizedBox(width: 56),
                        SizedBox(width: 470, child: form),
                      ],
                    ),
                  ),
                ),
              );
            }

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
              children: [
                intro,
                const SizedBox(height: 10),
                form,
                const SizedBox(height: 12),
                _buildCompactRoute(context),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildIntro(BuildContext context, {required bool compact}) {
    final title = widget.role == AppAudience.worker
        ? 'Tu próximo turno empieza aquí'
        : 'Organiza tu equipo con claridad';
    final description = widget.role == AppAudience.worker
        ? 'Encuentra oportunidades confiables, postúlate en pocos pasos y lleva el control de cada turno.'
        : 'Publica turnos, revisa postulaciones y confirma a la persona indicada desde un solo lugar.';

    final benefits = widget.role == AppAudience.worker
        ? const [
            (Icons.search_rounded, 'Turnos cerca de ti'),
            (Icons.bolt_rounded, 'Postulación rápida'),
            (Icons.timeline_rounded, 'Estados fáciles de seguir'),
          ]
        : const [
            (Icons.event_available_rounded, 'Publicación simple'),
            (Icons.people_alt_outlined, 'Postulantes visibles'),
            (Icons.check_circle_outline_rounded, 'Confirmación clara'),
          ];

    if (compact) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _BrandMark(compact: true),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 4),
                Text(
                  description,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const _BrandMark(),
        const SizedBox(height: 28),
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(fontSize: 34),
        ),
        const SizedBox(height: 14),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 430),
          child: Text(
            description,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ),
        const SizedBox(height: 30),
        ...benefits.map(
          (benefit) => Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: const BoxDecoration(
                    color: AppColors.tealSoft,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(benefit.$1, color: AppColors.tealDark, size: 19),
                ),
                const SizedBox(width: 12),
                Text(benefit.$2, style: Theme.of(context).textTheme.bodyLarge),
              ],
            ),
          ),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [AppColors.navy, Color(0xFF2F4770)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            children: [
              const Icon(Icons.route_rounded, color: AppColors.teal, size: 25),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  widget.role == AppAudience.worker
                      ? 'Busca → postúlate → confirma'
                      : 'Publica → elige → confirma',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFormCard(BuildContext context, {required bool compact}) {
    final cardPadding = compact ? 14.0 : 28.0;
    final sectionGap = compact ? 10.0 : 22.0;
    final fieldGap = compact ? 8.0 : 14.0;
    final fieldContentPadding = EdgeInsets.symmetric(
      horizontal: 14,
      vertical: compact ? 9 : 15,
    );

    return Card(
      key: const Key('auth-content'),
      elevation: 2,
      shadowColor: AppColors.shadow,
      child: Padding(
        padding: EdgeInsets.all(cardPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: compact ? 36 : 42,
                  height: compact ? 36 : 42,
                  decoration: const BoxDecoration(
                    color: AppColors.tealSoft,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.verified_user_outlined,
                    color: AppColors.tealDark,
                    size: compact ? 19 : 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    widget.role == AppAudience.worker
                        ? 'Acceso trabajador'
                        : 'Acceso empresa',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            SizedBox(height: sectionGap),
            Text(
              _isInGoogleOnboarding
                  ? 'Protege tu acceso'
                  : _isRegistering
                  ? 'Comienza con lo esencial'
                  : 'Ingresa para continuar',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: compact ? 16 : null),
            ),
            if (!compact) ...[
              const SizedBox(height: 4),
              Text(
                _isCompletingGoogleProfile
                    ? 'Tu cuenta de Google ya fue verificada. Confirma tu DNI y crea una contraseña exclusiva para Cumple Now.'
                    : _isCompletingGooglePassword
                    ? 'Tu cuenta de Google fue verificada. Crea una contraseña exclusiva para ingresar también con tu correo.'
                    : _isRegistering
                    ? 'Solo te pediremos lo esencial para comenzar.'
                    : 'Tus oportunidades y postulaciones te esperan.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
            if (widget.demoMode && !(compact && _isRegistering)) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.science_outlined,
                      color: AppColors.tealDark,
                      size: 18,
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Modo demostración: el acceso se valida localmente y no crea una cuenta real.',
                        style: TextStyle(
                          color: AppColors.muted,
                          fontSize: 11,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            SizedBox(height: sectionGap),
            Form(
              key: _formKey,
              child: Column(
                children: [
                  if (_isCompletingGoogleProfile)
                    TextFormField(
                      controller: _identifier,
                      keyboardType: TextInputType.number,
                      maxLength: 8,
                      decoration: InputDecoration(
                        labelText: 'DNI',
                        helperText:
                            'Lo usamos para crear tu perfil de trabajador.',
                        counterText: '',
                        contentPadding: fieldContentPadding,
                      ),
                      validator: (value) =>
                          value == null ||
                              !RegExp(r'^\d{8}$').hasMatch(value.trim())
                          ? 'El DNI debe tener exactamente 8 dígitos'
                          : null,
                    ),
                  if (_isInGoogleOnboarding) ...[
                    SizedBox(height: fieldGap),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: InputDecoration(
                        labelText: 'Contraseña de Cumple Now',
                        helperText:
                            'Nueva y exclusiva: no uses tu contraseña de Google.',
                        contentPadding: fieldContentPadding,
                      ),
                      validator: (value) {
                        if (value == null || value.length < 8) {
                          return 'Mínimo 8 caracteres';
                        }
                        if (!RegExp(r'[A-Z]').hasMatch(value)) {
                          return 'Incluye al menos una mayúscula';
                        }
                        if (!RegExp(r'\d').hasMatch(value)) {
                          return 'Incluye al menos un número';
                        }
                        return null;
                      },
                    ),
                  ]
                  else ...[
                    if (_isRegistering && _canRegister)
                      TextFormField(
                        controller: _name,
                        decoration: InputDecoration(
                          labelText: 'Nombre completo',
                          contentPadding: fieldContentPadding,
                        ),
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? 'Ingresa un nombre'
                            : null,
                      ),
                    if (_isRegistering && _canRegister)
                      SizedBox(height: fieldGap),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: InputDecoration(
                        labelText: 'Correo electrónico',
                        contentPadding: fieldContentPadding,
                      ),
                      validator: (value) =>
                          value == null ||
                              !RegExp(r'^\S+@\S+\.\S+$').hasMatch(value.trim())
                          ? 'Ingresa un correo válido'
                          : null,
                    ),
                    SizedBox(height: fieldGap),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: [
                        _isRegistering
                            ? AutofillHints.newPassword
                            : AutofillHints.password,
                      ],
                      decoration: InputDecoration(
                        labelText: 'Contraseña',
                        contentPadding: fieldContentPadding,
                      ),
                      validator: (value) {
                        if (value == null || value.length < 8)
                          return 'Mínimo 8 caracteres';
                        if (!RegExp(r'[A-Z]').hasMatch(value))
                          return 'Incluye al menos una mayúscula';
                        if (!RegExp(r'\d').hasMatch(value))
                          return 'Incluye al menos un número';
                        return null;
                      },
                    ),
                    if (_isRegistering && _canRegister) ...[
                      SizedBox(height: fieldGap),
                      TextFormField(
                        controller: _identifier,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText: 'DNI',
                          contentPadding: fieldContentPadding,
                        ),
                        validator: (value) =>
                            value == null ||
                                !RegExp(r'^\d{8}$').hasMatch(value.trim())
                            ? 'El DNI debe tener exactamente 8 dígitos'
                            : null,
                      ),
                    ],
                  ],
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            SizedBox(height: compact ? 14 : 22),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _isLoading ? null : _submit,
                child: Text(
                  _isLoading
                      ? 'Procesando…'
                      : _isInGoogleOnboarding
                      ? 'Guardar contraseña y continuar'
                      : (_isRegistering ? 'Crear cuenta' : 'Ingresar'),
                ),
              ),
            ),
            if (_isInGoogleOnboarding) ...[
              const SizedBox(height: 6),
              const Text(
                'Luego podrás cargar tu CV y agregar especialidades, experiencia y disponibilidad.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              Center(
                child: TextButton(
                  onPressed: _isLoading
                      ? null
                      : () => setState(() {
                          _pendingGoogleProfileSetupToken = null;
                          _pendingGooglePasswordSession = null;
                          _identifier.clear();
                          _password.clear();
                          _error = null;
                        }),
                  child: const Text('Usar otra cuenta'),
                ),
              ),
            ],
            if (_canRegister && !_isInGoogleOnboarding)
              Center(
                child: TextButton(
                  onPressed: () =>
                      setState(() => _isRegistering = !_isRegistering),
                  child: Text(
                    _isRegistering
                        ? 'Ya tengo una cuenta'
                        : 'Quiero registrarme',
                  ),
                ),
              ),
            if (_googleEnabled &&
                !_isRegistering &&
                !_isInGoogleOnboarding) ...[
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 14),
                child: Row(
                  children: [
                    Expanded(child: Divider()),
                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 10),
                      child: Text(
                        'o continúa con',
                        style: TextStyle(color: AppColors.muted, fontSize: 12),
                      ),
                    ),
                    Expanded(child: Divider()),
                  ],
                ),
              ),
              Center(
                child: GoogleSignInButton(
                  clientId: _googleClientId,
                  enabled: !_isLoading,
                  onIdToken: _signInWithGoogle,
                  onFailure: (message) {
                    if (mounted) setState(() => _error = message);
                  },
                ),
              ),
            ],
            if (_canRegister && !_isRegistering && !_isInGoogleOnboarding)
              const Text(
                'Las cuentas empresariales se habilitan directamente con Cumple Now.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            if (!compact) ...[
              const SizedBox(height: 8),
              const Text(
                'La verificación facial y la foto de DNI estarán disponibles solo cuando exista un proveedor autorizado.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCompactRoute(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
    decoration: BoxDecoration(
      color: AppColors.navySoft,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.border),
    ),
    child: Row(
      children: [
        const Icon(Icons.route_rounded, color: AppColors.tealDark, size: 22),
        const SizedBox(width: 10),
        Expanded(
          child: Text.rich(
            TextSpan(
              text: 'Tu ruta: ',
              style: const TextStyle(
                color: AppColors.navy,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
              children: [
                TextSpan(
                  text: widget.role == AppAudience.worker
                      ? 'busca · postúlate · confirma'
                      : 'publica · elige · confirma',
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class _BrandMark extends StatelessWidget {
  const _BrandMark({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: compact ? 34 : 46,
        height: compact ? 34 : 46,
        decoration: BoxDecoration(
          color: AppColors.teal,
          borderRadius: BorderRadius.circular(compact ? 10 : 14),
        ),
        child: Icon(
          Icons.check_rounded,
          color: AppColors.navy,
          size: compact ? 21 : 28,
        ),
      ),
      const SizedBox(width: 12),
      Text.rich(
        TextSpan(
          text: 'CUMPLE ',
          style: TextStyle(
            color: AppColors.navy,
            fontSize: compact ? 16 : 20,
            fontWeight: FontWeight.w900,
            letterSpacing: -.4,
          ),
          children: const [
            TextSpan(
              text: 'NOW',
              style: TextStyle(color: AppColors.tealDark),
            ),
          ],
        ),
      ),
    ],
  );
}
