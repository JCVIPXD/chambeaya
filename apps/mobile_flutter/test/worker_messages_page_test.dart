import 'package:chambeaya_mobile/features/marketplace/marketplace_repository.dart';
import 'package:chambeaya_mobile/features/marketplace/worker_secondary_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Cubre los dos sitios de `WorkerMessagesPage` que antes asignaban un `Future`
// dentro de un `setState(() => _loading = ...)` de cuerpo de expresión. En
// modo debug `setState` lanza una aserción cuando su callback devuelve un
// `Future`, y esa aserción salta ANTES de `markNeedsBuild`: la pantalla no se
// reconstruía. En el sondeo (`_poll`) el error además lo tragaba `catch (_)`,
// así que el síntoma era silencioso: la lista simplemente dejaba de
// refrescarse. Por eso las pruebas verifican el efecto visible (la lista
// nueva aparece), no solo `takeException`. La tercera prueba cubre el `catch`
// del sondeo: un fallo conserva la lista, muestra un aviso discreto y el
// siguiente sondeo exitoso lo limpia. La cuarta cubre el "Reintentar" de la
// pantalla de error de carga: un sondeo fallido detrás de esa pantalla enciende
// la bandera, y el reintento exitoso debe limpiarla.
void main() {
  testWidgets(
    'retrying after a failed load reloads the conversations without a '
    'setState assertion',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () => Future.error(StateError('sin conexión')),
        () async => [_conversation('c1', 'Restaurante La Mar')],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('No pudimos cargar tus mensajes'), findsOneWidget);

      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('No pudimos cargar tus mensajes'), findsNothing);
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    'the periodic poll swaps in the refreshed conversations and rebuilds',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () async => [_conversation('c1', 'Restaurante La Mar')],
        () async => [
          _conversation('c1', 'Restaurante La Mar'),
          _conversation('c2', 'Eventos Perú'),
        ],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('Eventos Perú'), findsNothing);

      // The 4-second timer fires `_poll`, which awaits the repository and then
      // replaces `_loading`; the extra pumps let that microtask chain and the
      // rebuild run.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('Eventos Perú'), findsOneWidget);
      await _unmount(tester);
    },
  );

  testWidgets(
    'a failed poll keeps the list, shows a notice and clears it once a later '
    'poll succeeds',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () async => [_conversation('c1', 'Restaurante La Mar')],
        () => Future.error(StateError('sin conexión')),
        () async => [
          _conversation('c1', 'Restaurante La Mar'),
          _conversation('c2', 'Eventos Perú'),
        ],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);

      // First poll fails: the list already on screen stays, the full-screen
      // error state does not replace it, and the notice tells the worker the
      // data may be stale.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('No pudimos cargar tus mensajes'), findsNothing);
      expect(find.textContaining('No pudimos actualizar'), findsOneWidget);

      // The timer keeps retrying; the next success brings the fresh list and
      // clears the notice.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text('Eventos Perú'), findsOneWidget);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);
      await _unmount(tester);
    },
  );

  testWidgets(
    'retrying from the load error screen clears a notice raised by a poll that '
    'failed in the meantime',
    (tester) async {
      final repository = _ScriptedConversationsRepository([
        () => Future.error(StateError('sin conexión')),
        () => Future.error(StateError('sin conexión')),
        () async => [_conversation('c1', 'Restaurante La Mar')],
      ]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: WorkerMessagesPage(repository: repository)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('No pudimos cargar tus mensajes'), findsOneWidget);

      // A poll fails while the initial-load error screen is still showing: it
      // raises the flag behind that screen, which keeps precedence.
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      await tester.pump();
      expect(find.text('No pudimos cargar tus mensajes'), findsOneWidget);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);

      // The worker taps "Reintentar" before the next tick and the reload works:
      // nothing is failing any more, so the stale notice must not appear on top
      // of the fresh list while waiting for the next poll to clear it.
      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Restaurante La Mar'), findsOneWidget);
      expect(find.text('No pudimos cargar tus mensajes'), findsNothing);
      expect(find.textContaining('No pudimos actualizar'), findsNothing);
      await _unmount(tester);
    },
  );
}

// Unmounts the page so its periodic refresh timer is cancelled by `dispose`
// before the test ends.
Future<void> _unmount(WidgetTester tester) =>
    tester.pumpWidget(const SizedBox.shrink());

WorkerConversationRecord _conversation(String id, String company) =>
    WorkerConversationRecord(
      id: id,
      company: company,
      subject: 'Postulación · Mozo de Salón',
      updatedAt: DateTime(2026, 9, 18, 12),
      messages: const [],
    );

/// Answers each `workerConversations()` call with the next scripted result and
/// keeps repeating the last one, so the page's retries and polling never run
/// off the end of the script.
class _ScriptedConversationsRepository extends DemoWorkerMarketplaceRepository {
  _ScriptedConversationsRepository(this._script);

  final List<Future<List<WorkerConversationRecord>> Function()> _script;
  var _calls = 0;

  @override
  Future<List<WorkerConversationRecord>> workerConversations() {
    final index = _calls < _script.length ? _calls : _script.length - 1;
    _calls++;
    return _script[index]();
  }
}
