import 'package:cumple_now_mobile/features/auth/auth_page.dart';
import 'package:cumple_now_mobile/features/auth/auth_repository.dart';
import 'package:cumple_now_mobile/features/auth/auth_session.dart';
import 'package:cumple_now_mobile/features/onboarding/onboarding_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<void> expectLoginError(
    WidgetTester tester,
    Object error,
    String message,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AuthPage(
          role: AppAudience.worker,
          demoMode: false,
          repository: _FailingAuthRepository(error),
        ),
      ),
    );
    await tester.enterText(find.byType(TextFormField).at(0), 'a@b.pe');
    await tester.enterText(find.byType(TextFormField).at(1), 'Password1');
    await tester.tap(find.text('Ingresar'));
    await tester.pump();
    expect(find.text(message), findsOneWidget);
  }

  testWidgets('login explains invalid credentials', (tester) async {
    await expectLoginError(
      tester,
      const AuthFailure(AuthFailureKind.invalidCredentials, statusCode: 401),
      'Correo o contraseña incorrectos. Revisa tus datos e inténtalo nuevamente.',
    );
  });

  testWidgets('login distinguishes connectivity failures', (tester) async {
    await expectLoginError(
      tester,
      const AuthFailure(AuthFailureKind.connectivity),
      'No se pudo conectar con el servicio. Comprueba tu conexión e inténtalo nuevamente.',
    );
  });

  testWidgets('registration validates API password and DNI requirements', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AuthPage(role: AppAudience.worker, demoMode: false)),
    );
    await tester.tap(find.text('Quiero registrarme'));
    await tester.pump();
    await tester.enterText(find.byType(TextFormField).at(0), 'Persona');
    await tester.enterText(find.byType(TextFormField).at(1), 'persona@demo.pe');
    await tester.enterText(find.byType(TextFormField).at(2), 'password');
    await tester.enterText(find.byType(TextFormField).at(3), '1234');
    await tester.tap(find.text('Crear cuenta'));
    await tester.pump();
    expect(find.text('Incluye al menos una mayúscula'), findsOneWidget);
    expect(find.text('El DNI debe tener exactamente 8 dígitos'), findsOneWidget);
  });

  testWidgets('worker authentication starts in login mode', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AuthPage(role: AppAudience.worker)),
    );

    expect(find.text('Inicia sesión'), findsOneWidget);
    expect(find.text('DNI'), findsNothing);
    expect(find.text('Quiero registrarme'), findsOneWidget);

    await tester.tap(find.text('Quiero registrarme'));
    await tester.pump();
    expect(find.text('Crea tu cuenta'), findsOneWidget);
    expect(find.text('DNI'), findsOneWidget);
  });

  testWidgets('explicit demo registration enters without waiting for the API', (
    tester,
  ) async {
    var authenticated = false;
    await tester.pumpWidget(
      MaterialApp(
        home: AuthPage(
          role: AppAudience.worker,
          demoMode: true,
          onAuthenticated: (_) async => authenticated = true,
        ),
      ),
    );

    await tester.tap(find.text('Quiero registrarme'));
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).at(0), 'Cliente Demo');
    await tester.enterText(find.byType(TextFormField).at(1), 'cliente@demo.pe');
    await tester.enterText(find.byType(TextFormField).at(2), 'Demo2026');
    await tester.enterText(find.byType(TextFormField).at(3), '12345678');
    await tester.tap(find.text('Crear cuenta'));
    await tester.pump();

    expect(authenticated, isTrue);
  });

  testWidgets('desktop authentication keeps a readable form width', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(home: AuthPage(role: AppAudience.worker)),
    );

    final content = find.byKey(const Key('auth-content'));
    expect(content, findsOneWidget);
    expect(tester.getSize(content).width, lessThanOrEqualTo(600));
    expect(find.textContaining('Modo demostración'), findsNothing);

    await tester.pumpWidget(
      const MaterialApp(home: AuthPage(role: AppAudience.worker, demoMode: true)),
    );
    expect(find.textContaining('Modo demostración'), findsOneWidget);
  });
}

class _FailingAuthRepository extends AuthRepository {
  _FailingAuthRepository(this.error);
  final Object error;

  @override
  Future<AuthSession> login({required String email, required String password}) {
    return Future<AuthSession>.error(error);
  }
}
