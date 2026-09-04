import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../onboarding/onboarding_page.dart';
import 'auth_repository.dart';
import 'auth_session.dart';

class AuthPage extends StatefulWidget {
  const AuthPage({
    super.key,
    required this.role,
    this.useLocalApi = false,
    this.repository,
    this.onAuthenticated,
  });
  final AppAudience role;
  final bool useLocalApi;
  final AuthRepository? repository;
  final Future<void> Function(AuthSession session)? onAuthenticated;

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

  bool get _canRegister => widget.role == AppAudience.worker;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _identifier.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (!widget.useLocalApi) {
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

  String _messageForFailure(AuthFailure failure) {
    if (_isRegistering && failure.code == 'DUPLICATE_ACCOUNT') {
      return 'Ya existe una cuenta con ese correo. Inicia sesión o usa otro correo.';
    }
    if (_isRegistering && failure.code == 'INVALID_REGISTRATION') {
      return 'Revisa nombre, correo, contraseña y DNI: deben cumplir los requisitos indicados.';
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
              _isRegistering
                  ? 'Comienza con lo esencial'
                  : 'Ingresa para continuar',
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontSize: compact ? 16 : null),
            ),
            if (!compact) ...[
              const SizedBox(height: 4),
              Text(
                _isRegistering
                    ? 'Solo te pediremos lo esencial para comenzar.'
                    : 'Tus oportunidades y postulaciones te esperan.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
            if (!widget.useLocalApi && !(compact && _isRegistering)) ...[
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
                      : (_isRegistering ? 'Crear cuenta' : 'Ingresar'),
                ),
              ),
            ),
            if (_canRegister)
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
            if (_canRegister && !_isRegistering)
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
