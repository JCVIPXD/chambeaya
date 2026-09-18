import 'package:shared_preferences/shared_preferences.dart';

import '../onboarding/onboarding_page.dart';
import 'auth_session.dart';

abstract interface class AuthSessionStore {
  Future<AuthSession?> read();
  Future<void> write(AuthSession session);
  Future<void> clear();
}

class SharedPreferencesAuthSessionStore implements AuthSessionStore {
  static const _tokenKey = 'chambeaya.session.token';
  static const _audienceKey = 'chambeaya.session.audience';
  static const _nameKey = 'chambeaya.session.name';

  @override
  Future<AuthSession?> read() async {
    final preferences = await SharedPreferences.getInstance();
    final token = preferences.getString(_tokenKey);
    final audienceValue = preferences.getString(_audienceKey);
    final name = preferences.getString(_nameKey);
    if (token == null ||
        token.isEmpty ||
        audienceValue == null ||
        name == null) {
      return null;
    }
    final audience = switch (audienceValue) {
      'worker' => AppAudience.worker,
      'company' => AppAudience.company,
      _ => null,
    };
    if (audience == null) {
      await clear();
      return null;
    }
    return AuthSession(token: token, audience: audience, name: name);
  }

  @override
  Future<void> write(AuthSession session) async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_audienceKey, session.audience.name);
    await preferences.setString(_nameKey, session.name);
    await preferences.setString(_tokenKey, session.token);
  }

  @override
  Future<void> clear() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_tokenKey);
    await preferences.remove(_audienceKey);
    await preferences.remove(_nameKey);
  }
}
