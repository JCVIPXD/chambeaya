import 'dart:async';

import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'jobs_errors.dart';

/// Panel de estado vacío o de error con una acción opcional.
class StatePanel extends StatelessWidget {
  const StatePanel({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border.all(color: palette.border),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: AppColors.teal, size: 36),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (message != null) ...[
              const SizedBox(height: 6),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: TextStyle(color: palette.muted, height: 1.4),
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 14),
              OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

class LoadingPanel extends StatelessWidget {
  const LoadingPanel({super.key, this.label = 'Cargando'});

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(32),
    child: Center(child: CircularProgressIndicator(semanticsLabel: label)),
  );
}

/// Etiqueta de estado. El texto usa el color de tinta de la paleta (contraste
/// alto en claro y oscuro); el color de marca solo tiñe el fondo y el punto.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color, this.icon});

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .18),
        border: Border.all(color: color.withValues(alpha: .55)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon ?? Icons.circle, size: icon == null ? 8 : 14, color: color),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                color: palette.ink,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Tarjeta con título para agrupar contenido.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    required this.child,
    this.icon,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, color: AppColors.teal),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ),
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: TextStyle(color: palette.muted, fontSize: 13)),
          ],
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

/// Aviso de error de una acción con el camino siguiente: reintentar (con la
/// cuenta regresiva de `Retry-After`) o ver la billetera.
class ErrorNotice extends StatefulWidget {
  const ErrorNotice({
    super.key,
    required this.info,
    this.onRetry,
    this.onOpenWallet,
  });

  final JobsErrorInfo info;
  final VoidCallback? onRetry;
  final VoidCallback? onOpenWallet;

  @override
  State<ErrorNotice> createState() => _ErrorNoticeState();
}

class _ErrorNoticeState extends State<ErrorNotice> {
  Timer? _timer;
  int _remaining = 0;

  @override
  void initState() {
    super.initState();
    _startCountdown();
  }

  @override
  void didUpdateWidget(ErrorNotice oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.info, widget.info)) _startCountdown();
  }

  void _startCountdown() {
    _timer?.cancel();
    _remaining = widget.info.kind == JobsErrorKind.retry
        ? (widget.info.retryAfterSeconds ?? 1)
        : 0;
    if (_remaining > 0) {
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) return;
        setState(() => _remaining -= 1);
        if (_remaining <= 0) timer.cancel();
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final info = widget.info;
    final canRetry = widget.onRetry != null && info.canRetry;
    final showWallet =
        widget.onOpenWallet != null &&
        (info.kind == JobsErrorKind.insufficient ||
            info.kind == JobsErrorKind.dailyCap);
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF4E5),
          border: Border.all(color: AppColors.gold),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline_rounded, color: AppColors.navy),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    info.message,
                    style: const TextStyle(color: AppColors.navy, height: 1.4),
                  ),
                ),
              ],
            ),
            if (canRetry || showWallet) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (canRetry)
                    FilledButton(
                      onPressed: _remaining > 0 ? null : widget.onRetry,
                      child: Text(
                        _remaining > 0
                            ? 'Reintentar en ${_remaining}s'
                            : 'Reintentar',
                      ),
                    ),
                  if (showWallet)
                    OutlinedButton(
                      onPressed: widget.onOpenWallet,
                      child: const Text('Ver mi billetera'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Fila de dato con etiqueta y valor. El valor es siempre texto plano.
class FactRow extends StatelessWidget {
  const FactRow({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Semantics(
        container: true,
        label: '$label: $value',
        excludeSemantics: true,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 4,
              child: Text(label, style: TextStyle(color: palette.muted, fontSize: 13)),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 6,
              child: Text(
                value,
                style: TextStyle(
                  color: palette.ink,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Texto largo de la empresa (descripción, requisitos, notas): siempre plano.
class LongText extends StatelessWidget {
  const LongText(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(color: context.palette.ink, fontSize: 14, height: 1.5),
  );
}
