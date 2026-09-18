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
// nueva aparece), no solo `takeException`.
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
