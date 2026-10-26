import 'package:flutter/foundation.dart';

import '../../core/safe_notify.dart';

import 'jobs_errors.dart';
import 'jobs_models.dart';
import 'jobs_repository.dart';

/// Estado de la lista de puestos: filtros, páginas por cursor y errores.
///
/// Garantías:
///  * un cambio de filtro descarta cualquier respuesta anterior (no se mezclan
///    filas de dos búsquedas);
///  * `loadMore` nunca corre dos veces a la vez ni sin cursor;
///  * las filas se agregan por `id`: una fila repetida entre páginas no se
///    duplica, y el orden de la API se conserva (no se salta ninguna);
///  * si falla una página siguiente, lo ya cargado se conserva y se puede
///    reintentar solo esa página.
class JobPostingsController extends ChangeNotifier {
  JobPostingsController(this.repository, {this.pageSize = 20});

  final JobsRepository repository;
  final int pageSize;

  JobSearchFilter _filter = const JobSearchFilter();
  final List<JobPosting> _items = [];
  final Set<String> _ids = {};
  String? _nextCursor;
  bool _loading = false;
  bool _loadingMore = false;
  bool _loadedOnce = false;
  JobsErrorInfo? _error;
  JobsErrorInfo? _moreError;
  int _generation = 0;
  bool _disposed = false;

  JobSearchFilter get filter => _filter;
  List<JobPosting> get items => List.unmodifiable(_items);
  bool get loading => _loading;
  bool get loadingMore => _loadingMore;
  bool get loadedOnce => _loadedOnce;
  bool get hasMore => _nextCursor != null;
  JobsErrorInfo? get error => _error;
  JobsErrorInfo? get moreError => _moreError;
  bool get isEmpty => _loadedOnce && _error == null && _items.isEmpty;

  Future<void> setFilter(JobSearchFilter filter) {
    _filter = filter;
    return loadFirst();
  }

  /// (Re)carga desde la primera página con el filtro vigente.
  Future<void> loadFirst() async {
    final generation = ++_generation;
    _loading = true;
    _loadingMore = false;
    _error = null;
    _moreError = null;
    _notify();
    try {
      final page = await repository.searchPostings(_filter, limit: pageSize);
      if (generation != _generation) return;
      _items
        ..clear()
        ..addAll(_dedupe(page.items, reset: true));
      _nextCursor = page.nextCursor;
      _loadedOnce = true;
    } catch (error) {
      if (generation != _generation) return;
      _error = describeJobsError(error);
      _loadedOnce = true;
      _items.clear();
      _ids.clear();
      _nextCursor = null;
    } finally {
      if (generation == _generation) {
        _loading = false;
        _notify();
      }
    }
  }

  Future<void> loadMore() async {
    final cursor = _nextCursor;
    if (cursor == null || _loading || _loadingMore) return;
    final generation = _generation;
    _loadingMore = true;
    _moreError = null;
    _notify();
    try {
      final page = await repository.searchPostings(
        _filter,
        cursor: cursor,
        limit: pageSize,
      );
      if (generation != _generation) return;
      _items.addAll(_dedupe(page.items));
      _nextCursor = page.nextCursor;
    } catch (error) {
      if (generation != _generation) return;
      final info = describeJobsError(error);
      // Un cursor vencido obliga a empezar de nuevo: no se reintenta la misma página.
      if (info.code == 'INVALID_CURSOR') {
        _loadingMore = false;
        await loadFirst();
        return;
      }
      _moreError = info;
    } finally {
      if (generation == _generation) {
        _loadingMore = false;
        _notify();
      }
    }
  }

  /// Marca localmente la postulación propia de un puesto (tras postular).
  void markApplied(String postingId, MyApplicationRef application) {
    final index = _items.indexWhere((item) => item.id == postingId);
    if (index < 0) return;
    final current = _items[index];
    _items[index] = JobPosting(
      id: current.id,
      title: current.title,
      description: current.description,
      responsibilities: current.responsibilities,
      requirements: current.requirements,
      benefits: current.benefits,
      modality: current.modality,
      workload: current.workload,
      salary: current.salary,
      location: current.location,
      contractType: current.contractType,
      expectedStartDate: current.expectedStartDate,
      vacanciesRemaining: current.vacanciesRemaining,
      screeningQuestions: current.screeningQuestions,
      publishedAt: current.publishedAt,
      isHighlighted: current.isHighlighted,
      companyName: current.companyName,
      myApplication: application,
    );
    _notify();
  }

  List<JobPosting> _dedupe(List<JobPosting> page, {bool reset = false}) {
    if (reset) _ids.clear();
    final fresh = <JobPosting>[];
    for (final posting in page) {
      if (_ids.add(posting.id)) fresh.add(posting);
    }
    return fresh;
  }

  void _notify() {
    if (_disposed) return;
    notifyOutsideBuild(() {
      if (!_disposed) notifyListeners();
    });
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
