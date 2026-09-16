import '../onboarding/onboarding_page.dart';

class AuthSession {
  const AuthSession({
    required this.token,
    required this.audience,
    required this.name,
    this.requiresPasswordSetup = false,
    this.openProfileAfterSignIn = false,
  });

  final String token;
  final AppAudience audience;
  final String name;
  final bool requiresPasswordSetup;

  /// Used once after a new Google account is completed, so the worker lands
  /// on the profile that still needs CV, specialties and availability.
  final bool openProfileAfterSignIn;

  AuthSession copyWith({bool? openProfileAfterSignIn, bool? requiresPasswordSetup}) => AuthSession(
    token: token,
    audience: audience,
    name: name,
    requiresPasswordSetup: requiresPasswordSetup ?? this.requiresPasswordSetup,
    openProfileAfterSignIn:
        openProfileAfterSignIn ?? this.openProfileAfterSignIn,
  );

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    final token = json['token'];
    final role = json['role'];
    final name = json['name'];
    if (token is! String ||
        token.isEmpty ||
        role is! String ||
        name is! String) {
      throw const FormatException('Respuesta de sesión inválida');
    }
    return AuthSession(
      token: token,
      audience: role == 'BUSINESS' ? AppAudience.company : AppAudience.worker,
      name: name,
      requiresPasswordSetup: json['requiresPasswordSetup'] == true,
    );
  }
}
