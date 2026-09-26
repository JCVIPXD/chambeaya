import 'package:chambeaya_mobile/features/auth/auth_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Corrección de CN-20260926-008 (BAJO-5): faltaba una prueba del cableado
/// real de `main.dart` — `authRepository`/`sessionToken`/`googleOnlyAccount`
/// llegando desde `ChambeayaApp` hasta la tarjeta "Seguridad" de Perfil a
/// través de `WorkerShell` — porque la prueba de `profile_home_page_test.dart`
/// solo construye `ProfileHomePage` en aislamiento y pasa esos parámetros a
/// mano. `main.dart` no puede probarse de punta a punta con una sesión real
/// aquí (`_usesLiveApi: true` construye repositorios HTTP reales que
/// intentarían salir a la red), así que esta prueba cubre la capa
/// inmediatamente debajo: que `WorkerShell` (con los mismos parámetros que
/// `main.dart` le pasaría para una sesión real) reenvía correctamente a
/// `ProfileHomePage`, y que su propio `onLogout` sigue funcionando desde la
/// pestaña Perfil.
void main() {
  testWidgets(
    'con una sesión real, WorkerShell muestra "Cambiar contraseña" en Perfil y su onLogout sigue funcionando',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final authRepository = _RecordingAuthRepository();
      var loggedOut = false;

      await tester.pumpWidget(
        MaterialApp(
          home: WorkerShell(
            repository: DemoWorkerMarketplaceRepository(),
            authRepository: authRepository,
            sessionToken: 'token-de-sesion-real',
            onLogout: () => loggedOut = true,
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      expect(find.text('Seguridad'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('open-change-password')),
        findsOneWidget,
      );

      await tester.tap(find.byTooltip('Cerrar sesión'));
      expect(loggedOut, isTrue);
    },
  );

  testWidgets(
    'sin sesión real (modo demo), Perfil no ofrece "Cambiar contraseña"',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: WorkerShell(repository: DemoWorkerMarketplaceRepository()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Perfil'));
      await tester.pumpAndSettle();

      expect(find.text('Seguridad'), findsNothing);
      expect(
        find.byKey(const ValueKey('open-change-password')),
        findsNothing,
      );
    },
  );
}

class _RecordingAuthRepository extends AuthRepository {
  var calls = 0;

  @override
  Future<void> changePassword({
    required String token,
    required String currentPassword,
    required String newPassword,
  }) async {
    calls++;
  }
}
