import 'package:chambeaya_mobile/features/jobs/api_client.dart';
import 'package:chambeaya_mobile/features/jobs/demo_jobs_backend.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_services.dart';
import 'package:chambeaya_mobile/features/wallet/wallet_controller.dart';
import 'package:chambeaya_mobile/features/wallet/wallet_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/jobs_fixtures.dart';

// Billetera del trabajador: saldo, costos, premios, referido y movimientos,
// con el nombre de la moneda tomado siempre de la respuesta de la API.

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<JobsServices> _pumpWallet(
  WidgetTester tester,
  DemoJobsBackend backend, {
  Size size = const Size(390, 844),
  double textScale = 1,
}) async {
  final services = JobsServices.demo(backend);
  addTearDown(services.dispose);
  await pumpApp(
    tester,
    WalletPage(services: services),
    size: size,
    textScale: textScale,
  );
  await _settle(tester);
  return services;
}

/// Baja por la lista de la pestaña actual hasta que [finder] se construye.
Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(
    finder,
    200,
    scrollable: find
        .descendant(of: find.byType(ListView).first, matching: find.byType(Scrollable))
        .first,
  );
  await tester.pump();
}

Future<void> _openTab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label));
  await _settle(tester);
}

void main() {
  group('Saldo', () {
    testWidgets('muestra el saldo con el nombre de la moneda que da la API', (tester) async {
      await _pumpWallet(tester, DemoJobsBackend(currencyName: 'Puntos', balance: 1250));
      expect(find.text('Tu saldo'), findsOneWidget);
      expect(find.text('1.250 Puntos'), findsOneWidget);
      expect(find.textContaining('Chambitas'), findsNothing);
    });

    testWidgets('mientras no carga el saldo usa un nombre neutro y no inventa uno de marca', (
      tester,
    ) async {
      final services = JobsServices.demo(DemoJobsBackend());
      addTearDown(services.dispose);
      expect(services.walletController.currencyName, WalletController.fallbackCurrencyName);
      expect(services.walletController.balance, isNull);
    });

    testWidgets('si el saldo falla lo explica y se puede actualizar', (tester) async {
      final backend = DemoJobsBackend(balance: 30)
        ..scriptError('balance', const ApiException(0, 'NETWORK_ERROR'));
      await _pumpWallet(tester, backend);
      expect(find.textContaining('No pudimos conectar con el servidor'), findsOneWidget);
      await tester.tap(find.byTooltip('Actualizar saldo'));
      await _settle(tester);
      expect(find.text('30 Chambitas'), findsOneWidget);
    });

    testWidgets('una lectura vieja del saldo nunca pisa a una más nueva', (tester) async {
      final backend = DemoJobsBackend(balance: 10);
      final controller = WalletController(backend);
      addTearDown(controller.dispose);
      final first = controller.refresh();
      backend.scriptError('balance', const ApiException(0, 'NETWORK_ERROR'));
      final second = controller.refresh();
      await Future.wait([first, second]);
      // Solo cuenta la última lectura (la que falló), no la primera.
      expect(controller.error, isNotNull);
    });
  });

  group('Resumen', () {
    testWidgets('lista cuánto cuesta cada acción y el tope diario', (tester) async {
      await _pumpWallet(tester, DemoJobsBackend());
      expect(find.text('Cuánto cuesta cada acción'), findsOneWidget);
      expect(find.text('Tope diario de gasto'), findsOneWidget);
    });

    testWidgets('destacar el perfil cotiza, pide confirmar y descuenta el costo', (tester) async {
      final backend = DemoJobsBackend(balance: 30, highlightCost: 10);
      await _pumpWallet(tester, backend);
      final button = find.byKey(const Key('highlight-profile'));
      await _reveal(tester, button);
      await tester.tap(button);
      await _settle(tester);
      expect(find.text('Destacar tu perfil'), findsWidgets);
      expect(find.textContaining('Confirmar y pagar 10 Chambitas'), findsOneWidget);
      expect(backend.callCount('highlightProfile'), 0);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(backend.callCount('highlightProfile'), 1);
      expect(backend.currentBalance, 20);
      expect(find.text('20 Chambitas'), findsOneWidget);
      expect(find.textContaining('Tu perfil quedó destacado'), findsOneWidget);
    });

    testWidgets('destacar el perfil sin saldo no cobra y explica qué falta', (tester) async {
      final backend = DemoJobsBackend(balance: 4, highlightCost: 10);
      await _pumpWallet(tester, backend);
      final button = find.byKey(const Key('highlight-profile'));
      await _reveal(tester, button);
      await tester.tap(button);
      await _settle(tester);
      expect(find.textContaining('No tienes saldo suficiente'), findsOneWidget);
      expect(find.textContaining('Confirmar y pagar'), findsNothing);
      expect(backend.callCount('highlightProfile'), 0);
    });

    testWidgets('un 409 de tope diario al destacar se explica y no cobra', (tester) async {
      final backend = DemoJobsBackend(balance: 50)
        ..scriptError(
          'highlightProfile',
          const ApiException(
            409,
            'DAILY_SPEND_CAP_REACHED',
            details: {'cost': 10, 'dailyCap': 200, 'spentToday': 195},
          ),
        );
      await _pumpWallet(tester, backend);
      final button = find.byKey(const Key('highlight-profile'));
      await _reveal(tester, button);
      await tester.tap(button);
      await _settle(tester);
      await tester.tap(find.textContaining('Confirmar y pagar'));
      await _settle(tester);
      expect(find.textContaining('Alcanzaste el tope diario de gasto'), findsOneWidget);
      expect(backend.currentBalance, 50);
    });

    testWidgets('si los costos fallan lo dice y se reintenta solo esa sección', (tester) async {
      final backend = DemoJobsBackend()
        ..scriptError('catalog', const ApiException(500, 'INTERNAL'));
      await _pumpWallet(tester, backend);
      expect(find.text('No pudimos cargar los costos'), findsOneWidget);
      await tester.tap(find.text('Reintentar'));
      await _settle(tester);
      expect(find.text('Cuánto cuesta cada acción'), findsOneWidget);
    });
  });

  group('Ganar', () {
    testWidgets('muestra premios, topes y el código de referido', (tester) async {
      await _pumpWallet(tester, DemoJobsBackend());
      await _openTab(tester, 'Ganar');
      expect(find.text('Premios para ti'), findsOneWidget);
      expect(find.text('Límite de premios'), findsOneWidget);
      expect(find.text('Invita y gana'), findsOneWidget);
      expect(find.byKey(const Key('referral-code')), findsOneWidget);
      expect(find.text('DEMO2345'), findsOneWidget);
    });

    testWidgets('si los premios fallan, lo demás de la billetera sigue disponible', (
      tester,
    ) async {
      final backend = DemoJobsBackend()
        ..scriptError('rewards', const ApiException(503, 'SERIALIZATION_RETRY_EXHAUSTED'));
      await _pumpWallet(tester, backend);
      await _openTab(tester, 'Ganar');
      expect(find.text('No pudimos cargar tus premios'), findsOneWidget);
      await _openTab(tester, 'Resumen');
      expect(find.text('Cuánto cuesta cada acción'), findsOneWidget);
    });
  });

  group('Movimientos', () {
    testWidgets('lista los movimientos y pagina con cursor', (
      tester,
    ) async {
      final backend = DemoJobsBackend(balance: 50, freeQuotaPerMonth: 0, extraCost: 5)
        ..pageSize = 1;
      // Dos postulaciones con costo: tres movimientos con el bono de bienvenida.
      await backend.apply('demo-job-2');
      await backend.apply('demo-job-3');
      await _pumpWallet(tester, backend);
      await _openTab(tester, 'Movimientos');
      expect(backend.callCount('movements'), 1);
      // Cada pulsación trae una página más, hasta que no queda cursor.
      final more = find.byKey(const Key('load-more-movements'), skipOffstage: false);
      for (var i = 0; i < 2; i++) {
        await _reveal(tester, more);
        expect(more, findsOneWidget);
        await tester.tap(more);
        await _settle(tester);
      }
      expect(backend.callCount('movements'), 3);
      expect(more, findsNothing);
      expect(find.textContaining('Postulación a Cajero de tienda', skipOffstage: false), findsOneWidget);
      expect(find.textContaining('Postulación a Soporte técnico remoto', skipOffstage: false), findsOneWidget);
      expect(find.textContaining('Bono de bienvenida', skipOffstage: false), findsWidgets);
    });

    testWidgets('muestra el bono de bienvenida como primer movimiento', (tester) async {
      final backend = DemoJobsBackend(balance: 0);
      await _pumpWallet(tester, backend);
      await _openTab(tester, 'Movimientos');
      expect(find.textContaining('Bono de bienvenida'), findsWidgets);
    });

    testWidgets('si falla la lista se puede reintentar sin perder la pantalla', (tester) async {
      final backend = DemoJobsBackend()
        ..scriptError('movements', const ApiException(500, 'INTERNAL'));
      await _pumpWallet(tester, backend);
      await _openTab(tester, 'Movimientos');
      expect(find.text('No pudimos cargar tus movimientos'), findsOneWidget);
      await tester.tap(find.text('Reintentar'));
      await _settle(tester);
      expect(find.textContaining('Bono de bienvenida'), findsWidgets);
    });
  });

  testWidgets('con texto grande y pantalla angosta la billetera no se desborda', (tester) async {
    await _pumpWallet(
      tester,
      DemoJobsBackend(balance: 1234567),
      size: const Size(320, 640),
      textScale: 1.6,
    );
    expect(tester.takeException(), isNull);
    await _openTab(tester, 'Ganar');
    expect(tester.takeException(), isNull);
    await _openTab(tester, 'Movimientos');
    expect(tester.takeException(), isNull);
  });
}
