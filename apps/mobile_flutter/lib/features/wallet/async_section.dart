import 'package:flutter/material.dart';

import '../jobs/jobs_errors.dart';
import '../jobs/jobs_widgets.dart';

/// Carga un recurso con estados de carga y de error (con reintento). Cada
/// sección de la billetera falla por separado: un error en los premios no
/// oculta el saldo ni los movimientos.
class AsyncSection<T> extends StatefulWidget {
  const AsyncSection({
    super.key,
    required this.load,
    required this.builder,
    required this.errorTitle,
    this.loadingLabel = 'Cargando',
  });

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data) builder;
  final String errorTitle;
  final String loadingLabel;

  @override
  State<AsyncSection<T>> createState() => _AsyncSectionState<T>();
}

class _AsyncSectionState<T> extends State<AsyncSection<T>> {
  T? _data;
  JobsErrorInfo? _error;
  bool _loading = true;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.load();
      if (!mounted || generation != _generation) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = describeJobsError(error);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return LoadingPanel(label: widget.loadingLabel);
    if (_error != null && _data == null) {
      return StatePanel(
        icon: Icons.cloud_off_rounded,
        title: widget.errorTitle,
        message: _error!.message,
        actionLabel: 'Reintentar',
        onAction: _reload,
      );
    }
    return widget.builder(context, _data as T);
  }
}
