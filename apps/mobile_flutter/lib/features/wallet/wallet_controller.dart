import 'package:flutter/foundation.dart';

import '../../core/safe_notify.dart';

import '../jobs/jobs_errors.dart';
import 'wallet_repository.dart';

/// Saldo y nombre de la moneda del trabajador, compartidos por las pantallas.
///
/// El nombre de la moneda llega de la API (`currency`); mientras no se haya
/// cargado se usa el genérico "monedas" para no inventar un nombre de marca.
class WalletController extends ChangeNotifier {
  WalletController(this.repository);

  final WalletRepository repository;

  static const fallbackCurrencyName = 'monedas';

  int? _balance;
  String _currency = fallbackCurrencyName;
  bool _loading = false;
  JobsErrorInfo? _error;
  int _generation = 0;
  bool _disposed = false;

  int? get balance => _balance;
  String get currencyName => _currency;
  bool get loading => _loading;
  JobsErrorInfo? get error => _error;

  /// Aviso de que cambió el nombre de la moneda (p. ej. por una cotización).
  void adoptCurrencyName(String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty || trimmed == _currency) return;
    _currency = trimmed;
    _notify();
  }

  /// Vuelve a leer el saldo. Una lectura más vieja nunca pisa a una más nueva.
  Future<void> refresh() async {
    final generation = ++_generation;
    _loading = true;
    _error = null;
    _notify();
    try {
      final result = await repository.balance();
      if (generation != _generation) return;
      _balance = result.balance;
      if (result.currency.trim().isNotEmpty) _currency = result.currency.trim();
    } catch (error) {
      if (generation != _generation) return;
      _error = describeJobsError(error, currency: _currency);
    } finally {
      if (generation == _generation) {
        _loading = false;
        _notify();
      }
    }
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
