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
  var _isRegistering = true;
  var _isLoading = false;
  String? _error;

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
              audience: widget.role,
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
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'No se pudo completar el acceso. Verifica la API e inténtalo otra vez.',
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final worker = widget.role == AppAudience.worker;
    return Scaffold(
      appBar: AppBar(
        title: Text(_isRegistering ? 'Crea tu cuenta' : 'Inicia sesión'),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            key: const Key('auth-content'),
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: AppColors.tealSoft,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.verified_user_outlined,
                        color: AppColors.teal,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          worker ? 'Cuenta de trabajador' : 'Cuenta de empresa',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!widget.useLocalApi) ...[
                  const SizedBox(height: 12),
                  const Row(
                    children: [
                      Icon(
                        Icons.science_outlined,
                        color: AppColors.teal,
                        size: 18,
                      ),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Modo demostración: el acceso se valida localmente y no crea una cuenta real.',
                          style: TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 24),
                Form(
                  key: _formKey,
                  child: Column(
                    children: [
                      if (_isRegistering)
                        TextFormField(
                          controller: _name,
                          decoration: const InputDecoration(
                            labelText: 'Nombre completo o empresa',
                          ),
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? 'Ingresa un nombre'
                              : null,
                        ),
                      if (_isRegistering) const SizedBox(height: 14),
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        decoration: const InputDecoration(
                          labelText: 'Correo electrónico',
                        ),
                        validator: (value) =>
                            value == null || !value.contains('@')
                            ? 'Ingresa un correo válido'
                            : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        obscureText: true,
                        decoration: const InputDecoration(
                          labelText: 'Contraseña',
                        ),
                        validator: (value) => value == null || value.length < 8
                            ? 'Mínimo 8 caracteres'
                            : null,
                      ),
                      if (_isRegistering) ...[
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _identifier,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: worker ? 'DNI' : 'RUC',
                          ),
                          validator: (value) =>
                              value == null ||
                                  (worker
                                      ? value.length != 8
                                      : value.length != 11)
                              ? (worker
                                    ? 'El DNI tiene 8 dígitos'
                                    : 'El RUC tiene 11 dígitos')
                              : null,
                        ),
                      ],
                    ],
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                const SizedBox(height: 22),
                FilledButton(
                  onPressed: _isLoading ? null : _submit,
                  child: Text(
                    _isLoading
                        ? 'Procesando…'
                        : (_isRegistering ? 'Crear cuenta' : 'Ingresar'),
                  ),
                ),
                TextButton(
                  onPressed: () =>
                      setState(() => _isRegistering = !_isRegistering),
                  child: Text(
                    _isRegistering
                        ? 'Ya tengo una cuenta'
                        : 'Quiero registrarme',
                  ),
                ),
                const Text(
                  'La verificación facial y la foto de DNI estarán disponibles solo cuando exista un proveedor autorizado.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
