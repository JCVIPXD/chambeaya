import '../onboarding/onboarding_page.dart';

class AuthSession {
  const AuthSession({
    required this.token,
    required this.audience,
    required this.name,
  });

  final String token;
  final AppAudience audience;
  final String name;

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
    );
  }
}
