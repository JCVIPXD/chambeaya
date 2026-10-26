import 'package:flutter/foundation.dart';

import '../../core/safe_notify.dart';

import 'jobs_errors.dart';
import 'jobs_models.dart';
import 'jobs_repository.dart';

/// Estado de "Mis postulaciones": etapa elegida, historial, páginas por
/// cursor y actualización puntual por avisos en vivo.
class MyApplicationsController extends ChangeNotifier {
  MyApplicationsController(this.repository, {this.pageSize = 20});

  final JobsRepository repository;
  final int pageSize;

  ApplicationStatus? _stage;
  bool _history = false;
  final List<JobApplication> _items = [];
  final Set<String> _ids = {};
  String? _nextCursor;
  bool _loading = false;
  bool _loadingMore = false;
  bool _loadedOnce = false;
  JobsErrorInfo? _error;
  JobsErrorInfo? _moreError;
  int _generation = 0;
  bool _disposed = false;

  /// `null` = todas las etapas.
  ApplicationStatus? get stage => _stage;
  bool get history => _history;
  List<JobApplication> get items => List.unmodifiable(_items);
  bool get loading => _loading;
  bool get loadingMore => _loadingMore;
  bool get loadedOnce => _loadedOnce;
  bool get hasMore => _nextCursor != null;
  JobsErrorInfo? get error => _error;
  JobsErrorInfo? get moreError => _moreError;
  bool get isEmpty => _loadedOnce && _error == null && _items.isEmpty;

  Future<void> setStage(ApplicationStatus? stage) {
    _stage = stage;
    return load();
  }

  Future<void> setHistory(bool value) {
    _history = value;
    return load();
  }

  /// Carga la primera página. Con [silent] no muestra el indicador de carga ni
  /// borra lo que ya se ve si falla (se usa al volver a la pestaña).
  Future<void> load({bool silent = false}) async {
    final generation = ++_generation;
    _loadingMore = false;
    _moreError = null;
    if (!silent) {
      _loading = true;
      _error = null;
    }
    _notify();
    try {
      final page = await repository.myApplications(
        history: _history,
        status: _stage,
        limit: pageSize,
      );
      if (generation != _generation) return;
      _ids.clear();
      _items.clear();
      for (final item in page.items) {
        if (_ids.add(item.id)) _items.add(item);
      }
      _nextCursor = page.nextCursor;
      _error = null;
      _loadedOnce = true;
    } catch (error) {
      if (generation != _generation) return;
      if (!silent || !_loadedOnce) {
        _error = describeJobsError(error);
        _items.clear();
        _ids.clear();
        _nextCursor = null;
      }
      _loadedOnce = true;
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
      final page = await repository.myApplications(
        history: _history,
        status: _stage,
        cursor: cursor,
        limit: pageSize,
      );
      if (generation != _generation) return;
      for (final item in page.items) {
        if (_ids.add(item.id)) _items.add(item);
      }
      _nextCursor = page.nextCursor;
    } catch (error) {
      if (generation != _generation) return;
      _moreError = describeJobsError(error);
    } finally {
      if (generation == _generation) {
        _loadingMore = false;
        _notify();
      }
    }
  }

  /// Aviso en vivo: se vuelve a leer solo esa postulación; si no estaba en la
  /// lista (nueva o ahora visible) se recarga la primera página sin parpadeo.
  Future<void> applyNotification(JobEventNotification event) async {
    final index = _items.indexWhere((item) => item.id == event.applicationId);
    if (index < 0) {
      await load(silent: true);
      return;
    }
    try {
      final fresh = await repository.application(event.applicationId);
      final current = _items.indexWhere((item) => item.id == event.applicationId);
      if (current < 0) return;
      if (_matches(fresh)) {
        _items[current] = fresh;
      } else {
        _ids.remove(fresh.id);
        _items.removeAt(current);
      }
      _notify();
    } catch (_) {
      await load(silent: true);
    }
  }

  /// Reemplaza una postulación ya conocida (tras retirarse, aceptar, etc.).
  void replace(JobApplication application) {
    final index = _items.indexWhere((item) => item.id == application.id);
    if (index < 0) return;
    if (_matches(application)) {
      _items[index] = application;
    } else {
      _ids.remove(application.id);
      _items.removeAt(index);
    }
    _notify();
  }

  bool _matches(JobApplication application) {
    if (!_history && application.isAutoClosed) return false;
    if (_stage != null && application.status != _stage) return false;
    return true;
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
