import 'dart:async';

import 'package:chambeaya_mobile/features/marketplace/marketplace_data.dart';
import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_payments_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// `WorkerPaymentsPage` ("Mis pagos", Alcance D): pantalla de solo lectura
// accesible desde Perfil. Nunca deriva sus estados de `provider` (ese campo
// nunca llega al DTO del trabajador); todo depende de `PaymentRecord`
// (`status`, `receiptConfirmed`, `canConfirmReceipt`), tal como los expone
// `walletMovements()`.
void main() {
  testWidgets('mientras carga, muestra un indicador de progreso', (
    tester,
  ) async {
    final repository = _HoldablePaymentsRepository();
    await tester.pumpWidget(
      MaterialApp(home: WorkerPaymentsPage(repository: repository)),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    repository.answer(const []);
    await tester.pumpAndSettle();
  });

  testWidgets('sin pagos, muestra el estado vacío', (tester) async {
    final repository = _ScriptedPaymentsRepository([() async => const []]);
    await tester.pumpWidget(
      MaterialApp(home: WorkerPaymentsPage(repository: repository)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Todavía no tienes pagos'), findsOneWidget);
  });

  testWidgets(
    'si falla la carga, muestra el error con "Reintentar", que recarga la lista',
    (tester) async {
      final repository = _ScriptedPaymentsRepository([
        () => Future.error(StateError('sin conexión')),
        () async => [
          const PaymentRecord(
            id: 'payment-1',
            company: 'Mozo de salón · Restaurante Demo',
            role: 'Pago de turno',
            amount: 'S/ 100.00',
            status: 'Pendiente',
          ),
        ],
      ]);
      await tester.pumpWidget(
        MaterialApp(home: WorkerPaymentsPage(repository: repository)),
      );
      await tester.pumpAndSettle();

      expect(find.text('No pudimos cargar tus pagos'), findsOneWidget);

      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('No pudimos cargar tus pagos'), findsNothing);
      expect(find.text('Mozo de salón · Restaurante Demo'), findsOneWidget);
      expect(find.text('Pendiente de pago'), findsOneWidget);
    },
  );

  testWidgets(
    'muestra el monto, el estado y la fecha de cada pago, con los tres estados posibles',
    (tester) async {
      final repository = _ScriptedPaymentsRepository([
        () async => [
          const PaymentRecord(
            id: 'payment-pending',
            company: 'Anfitrión/a de eventos · Empresa Demo',
            role: 'Pago de turno',
            amount: 'S/ 120.00',
            status: 'Pendiente',
            date: '2026-09-10T12:00:00.000Z',
          ),
          const PaymentRecord(
            id: 'payment-paid',
            company: 'Apoyo de salón · Restaurante Demo',
            role: 'Pago de turno',
            amount: 'S/ 100.00',
            status: 'Liberado',
            canConfirmReceipt: true,
            date: '2026-09-15T12:00:00.000Z',
          ),
          const PaymentRecord(
            id: 'payment-confirmed',
            company: 'Barista · Café del Cielo',
            role: 'Pago de turno',
            amount: 'S/ 90.00',
            status: 'Liberado',
            receiptConfirmed: true,
            date: '2026-09-05T12:00:00.000Z',
          ),
        ],
      ]);
      await tester.pumpWidget(
        MaterialApp(home: WorkerPaymentsPage(repository: repository)),
      );
      await tester.pumpAndSettle();

      expect(find.text('Anfitrión/a de eventos · Empresa Demo'), findsOneWidget);
      expect(find.text('S/ 120.00'), findsOneWidget);
      expect(find.text('Pendiente de pago'), findsOneWidget);
      expect(find.text('10 sep 2026'), findsOneWidget);

      expect(find.text('Apoyo de salón · Restaurante Demo'), findsOneWidget);
      expect(find.text('S/ 100.00'), findsOneWidget);
      expect(find.text('Pagado'), findsOneWidget);
      expect(find.text('15 sep 2026'), findsOneWidget);

      expect(find.text('Barista · Café del Cielo'), findsOneWidget);
      expect(find.text('Recepción confirmada'), findsOneWidget);
      expect(find.text('5 sep 2026'), findsOneWidget);

      // "Confirmar recepción" aparece solo en el pago pagado y sin confirmar.
      expect(find.widgetWithText(OutlinedButton, 'Confirmar recepción'), findsOneWidget);
    },
  );

  testWidgets(
    'confirmar la recepción llama a confirmPayment y recarga la lista con el nuevo estado',
    (tester) async {
      var confirmed = false;
      final repository = _ScriptedPaymentsRepository([
        () async => [
          const PaymentRecord(
            id: 'payment-paid',
            company: 'Apoyo de salón · Restaurante Demo',
            role: 'Pago de turno',
            amount: 'S/ 100.00',
            status: 'Liberado',
            canConfirmReceipt: true,
          ),
        ],
        () async => [
          const PaymentRecord(
            id: 'payment-paid',
            company: 'Apoyo de salón · Restaurante Demo',
            role: 'Pago de turno',
            amount: 'S/ 100.00',
            status: 'Liberado',
            receiptConfirmed: true,
          ),
        ],
      ]);
      repository.onConfirm = (id) async {
        expect(id, 'payment-paid');
        confirmed = true;
      };
      await tester.pumpWidget(
        MaterialApp(home: WorkerPaymentsPage(repository: repository)),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(OutlinedButton, 'Confirmar recepción'));
      await tester.pumpAndSettle();

      expect(confirmed, isTrue);
      expect(find.text('Recepción confirmada'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Confirmar recepción'), findsNothing);
      expect(find.text('Recepción confirmada.'), findsOneWidget);
    },
  );

  testWidgets(
    'si confirmar la recepción falla, muestra un aviso y conserva el botón',
    (tester) async {
      final repository = _ScriptedPaymentsRepository([
        () async => [
          const PaymentRecord(
            id: 'payment-paid',
            company: 'Apoyo de salón · Restaurante Demo',
            role: 'Pago de turno',
            amount: 'S/ 100.00',
            status: 'Liberado',
            canConfirmReceipt: true,
          ),
        ],
      ]);
      repository.onConfirm = (_) async {
        throw StateError('sin conexión');
      };
      await tester.pumpWidget(
        MaterialApp(home: WorkerPaymentsPage(repository: repository)),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.widgetWithText(OutlinedButton, 'Confirmar recepción'));
      await tester.pumpAndSettle();

      expect(
        find.text('No pudimos confirmar la recepción. Inténtalo otra vez.'),
        findsOneWidget,
      );
      expect(find.widgetWithText(OutlinedButton, 'Confirmar recepción'), findsOneWidget);
    },
  );
}

class _ScriptedPaymentsRepository extends DemoWorkerMarketplaceRepository {
  _ScriptedPaymentsRepository(this._script);

  final List<Future<List<PaymentRecord>> Function()> _script;
  var _calls = 0;
  Future<void> Function(String id)? onConfirm;

  @override
  Future<List<PaymentRecord>> walletMovements() {
    final index = _calls < _script.length ? _calls : _script.length - 1;
    _calls++;
    return _script[index]();
  }

  @override
  Future<void> confirmPayment(String paymentId) async {
    final handler = onConfirm;
    if (handler != null) return handler(paymentId);
  }
}

/// Deja `walletMovements()` colgado hasta que el test [answer]e, para
/// comprobar el estado de carga (el indicador de progreso) antes de que la
/// lista llegue.
class _HoldablePaymentsRepository extends DemoWorkerMarketplaceRepository {
  final _completer = Completer<List<PaymentRecord>>();

  @override
  Future<List<PaymentRecord>> walletMovements() => _completer.future;

  void answer(List<PaymentRecord> value) => _completer.complete(value);
}
