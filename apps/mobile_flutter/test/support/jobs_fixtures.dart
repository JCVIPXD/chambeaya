import 'package:chambeaya_mobile/features/jobs/jobs_models.dart';
import 'package:chambeaya_mobile/features/jobs/jobs_repository.dart';
import 'package:chambeaya_mobile/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// JSON de un puesto como lo devuelve `GET /api/workers/job-postings`.
Map<String, dynamic> postingJson(
  String id, {
  String title = 'Asistente administrativo',
  bool highlighted = false,
  Map<String, dynamic>? myApplication,
  List<String> questions = const [],
}) => {
  'id': id,
  'title': title,
  'description': 'Descripción larga del puesto para pruebas automáticas.',
  'responsibilities': 'Archivar documentos',
  'requirements': 'Secundaria completa',
  'benefits': 'Seguro de salud',
  'modality': 'ONSITE',
  'workload': 'FULL_TIME',
  'salary': {'minCents': 150000, 'maxCents': 180000, 'currency': 'PEN'},
  'location': 'Miraflores, Lima',
  'contractType': 'INDEFINITE',
  'expectedStartDate': '2026-11-02T00:00:00.000Z',
  'vacanciesRemaining': 2,
  'screeningQuestions': questions,
  'publishedAt': '2026-10-10T12:00:00.000Z',
  'isHighlighted': highlighted,
  'company': {'name': 'Empresa $id'},
  'myApplication': myApplication,
};

Map<String, dynamic> offerJson(
  String id, {
  int version = 1,
  String status = 'PENDING',
  Map<String, dynamic>? snapshot,
  Map<String, dynamic>? document,
}) => {
  'id': id,
  'version': version,
  'status': status,
  'salaryCents': 250000,
  'currency': 'PEN',
  'contractType': 'INDEFINITE',
  'startDate': '2026-11-02T00:00:00.000Z',
  'note': 'Bienvenido',
  'document': document,
  'createdAt': '2026-10-12T10:00:00.000Z',
  'respondedAt': null,
  'acceptanceSnapshot': snapshot,
};

Map<String, dynamic> applicationJson(
  String id, {
  String status = 'APPLIED',
  List<Map<String, dynamic>> offers = const [],
  String? currentOfferId,
  String? autoClosedReason,
  bool isPriority = false,
  List<Map<String, dynamic>>? events,
}) => {
  'id': id,
  'status': status,
  'createdAt': '2026-10-11T10:00:00.000Z',
  'updatedAt': '2026-10-12T10:00:00.000Z',
  'isPriority': isPriority,
  'prioritizedAt': null,
  'autoClosedReason': autoClosedReason,
  'posting': {
    'id': 'p-$id',
    'title': 'Puesto $id',
    'companyName': 'Empresa $id',
    'modality': 'ONSITE',
    'workload': 'FULL_TIME',
    'location': 'Lima',
    'status': 'PUBLISHED',
    'salary': {'minCents': 150000, 'maxCents': 180000, 'currency': 'PEN'},
  },
  'screeningAnswers': const [],
  'interview': null,
  'currentOfferId': currentOfferId,
  'offers': offers,
  'events': events ??
      [
        {
          'id': 'e1',
          'type': 'APPLIED',
          'actorRole': 'WORKER',
          'fromStatus': null,
          'toStatus': 'APPLIED',
          'detail': null,
          'createdAt': '2026-10-11T10:00:00.000Z',
        },
      ],
};

Map<String, dynamic> quoteJson({
  int cost = 0,
  String reason = 'FREE_QUOTA',
  int balance = 50,
  bool sufficient = true,
  bool withinCap = true,
  String actionKey = 'APPLICATION_EXTRA',
  Map<String, dynamic>? freeQuota = const {
    'monthlyLimit': 10,
    'used': 3,
    'remaining': 7,
  },
}) => {
  'currency': 'Chambitas',
  'actionKey': actionKey,
  'actor': 'WORKER',
  'active': true,
  'cost': cost,
  'catalogAmount': 5,
  'reason': reason,
  'freeQuota': freeQuota,
  'balance': balance,
  'sufficientBalance': sufficient,
  'dailyCap': {'limit': 200, 'spentToday': 0, 'remaining': 200},
  'withinDailyCap': withinCap,
  'canExecute': sufficient && withinCap,
  'refundWindowHours': 72,
};

/// Un puesto de prueba ya modelado.
JobPosting samplePosting(
  String id, {
  bool highlighted = false,
  List<String> questions = const [],
}) => JobPosting.fromJson(
  postingJson(id, title: 'Puesto $id', highlighted: highlighted, questions: questions),
);

/// Repositorio de puestos escrito a mano: devuelve páginas guionadas.
class ScriptedJobsRepository implements JobsRepository {
  ScriptedJobsRepository(this.pages);

  /// Páginas por cursor (`null` es la primera).
  final Map<String?, PagedResult<JobPosting>> pages;
  final List<({JobSearchFilter filter, String? cursor})> requests = [];
  Object? failNext;
  Future<void> Function()? gate;

  @override
  Future<PagedResult<JobPosting>> searchPostings(
    JobSearchFilter filter, {
    String? cursor,
    int limit = 20,
  }) async {
    requests.add((filter: filter, cursor: cursor));
    final wait = gate;
    if (wait != null) await wait();
    final error = failNext;
    if (error != null) {
      failNext = null;
      throw error;
    }
    return pages[cursor] ?? const PagedResult(items: [], nextCursor: null);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

/// Monta [child] en una app con el tema real de Chambeaya y un tamaño dado.
Future<void> pumpApp(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(390, 844),
  double textScale = 1,
  Brightness brightness = Brightness.light,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(brightness),
      builder: (context, page) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
        child: page!,
      ),
      home: child,
    ),
  );
}
