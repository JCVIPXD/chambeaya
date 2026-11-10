import 'package:flutter/material.dart';

import '../jobs/jobs_errors.dart';
import '../jobs/jobs_format.dart';
import 'wallet_models.dart';
import 'wallet_repository.dart';

/// Una acción que puede costar moneda y que se cotiza antes de ejecutarla.
class CostRequest {
  const CostRequest({
    required this.actionKey,
    required this.label,
    this.targetId,
    this.optional = false,
    this.alwaysCharges = false,
  });

  final String actionKey;

  /// Texto que ve el usuario en el desglose ("Postulación con prioridad").
  final String label;
  final String? targetId;

  /// Una acción opcional (la prioridad) se puede descartar si no alcanza el
  /// saldo, sin cancelar la acción principal.
  final bool optional;

  /// La acción nunca tiene cuota gratuita: siempre cuesta. Si la cotización
  /// falla, no se puede ejecutar sin haber mostrado el costo (solo
  /// Reintentar o Cancelar). Una acción opcional con esta marca se descarta
  /// al continuar tras el fallo.
  final bool alwaysCharges;
}

class CostResult {
  const CostResult({
    required this.proceed,
    this.droppedOptional = false,
    this.total = 0,
  });

  /// El usuario aceptó (o la acción es gratuita) y se puede ejecutar.
  final bool proceed;

  /// Se continuó sin las acciones opcionales.
  final bool droppedOptional;
  final int total;
}

/// Regla única de costos antes de una acción:
///
///  1. Se consulta la cotización (`quote`), que no tiene efectos.
///  2. Si todo cuesta 0 (cuota gratuita, ya registrada o acción gratuita) se
///     ejecuta de inmediato: **nunca se pide confirmación, ni se bloquea por
///     saldo**.
///  3. Si hay costo se muestra el desglose, la cuota gratuita restante, el
///     saldo y lo que quedará, y solo entonces se pide confirmar.
///  4. Si el saldo o el tope diario no alcanzan, se explica y se ofrece el
///     camino siguiente (ver billetera o continuar sin lo opcional).
///  5. Si la cotización falla nunca se ejecuta una acción que siempre cobra
///     sin haber mostrado el costo: las acciones sin cuota gratuita
///     (`alwaysCharges`) solo ofrecen Reintentar o Cancelar, y las opcionales
///     (la prioridad al postular) se descartan al continuar. Una acción que
///     puede ser gratuita no se bloquea: el usuario puede continuar sabiendo
///     que el servidor descontará lo que corresponda y que no se cobrará nada
///     fuera del catálogo.
Future<CostResult> confirmCosts(
  BuildContext context, {
  required WalletRepository wallet,
  required String currencyName,
  required List<CostRequest> requests,
  required String title,
  VoidCallback? onOpenWallet,
  void Function(String currency)? onCurrency,
}) async {
  var active = requests;
  var dropped = false;
  while (true) {
    final quotes = <CostRequest, Quote>{};
    Object? failure;
    await Future.wait(
      active.map((request) async {
        try {
          quotes[request] = await wallet.quote(
            request.actionKey,
            targetId: request.targetId,
          );
        } catch (error) {
          failure = error;
        }
      }),
    );
    if (!context.mounted) return const CostResult(proceed: false);

    final firstQuote = quotes.values.isEmpty ? null : quotes.values.first;
    if (firstQuote != null) onCurrency?.call(firstQuote.currency);
    final currency = firstQuote != null && firstQuote.currency.trim().isNotEmpty
        ? firstQuote.currency
        : currencyName;

    if (failure != null) {
      final info = describeJobsError(failure!, currency: currency);
      final mustSeeCost = active.any(
        (request) => request.alwaysCharges && !request.optional,
      );
      final hasOptional = active.any((request) => request.optional);
      final choice = await showDialog<_UnknownCostChoice>(
        context: context,
        builder: (context) => _UnknownCostDialog(
          title: title,
          info: info,
          canContinue: !mustSeeCost,
          dropsOptional: hasOptional,
        ),
      );
      if (!context.mounted) return const CostResult(proceed: false);
      switch (choice) {
        case _UnknownCostChoice.retry:
          continue;
        case _UnknownCostChoice.continueAnyway:
          // Defensa: aunque el diálogo no ofrece «Continuar» cuando la acción
          // siempre cobra, nunca se ejecuta sin mostrar el costo.
          if (mustSeeCost) return const CostResult(proceed: false);
          return CostResult(
            proceed: true,
            droppedOptional: dropped || hasOptional,
          );
        case _UnknownCostChoice.cancel || null:
          return const CostResult(proceed: false);
      }
    }

    final lines = [
      for (final request in active)
        if (quotes[request] != null) (request: request, quote: quotes[request]!),
    ];
    final total = lines.fold<int>(0, (sum, line) => sum + line.quote.cost);
    if (total <= 0) {
      return CostResult(proceed: true, droppedOptional: dropped);
    }

    final balance = firstQuote?.balance ?? 0;
    final capRemaining = firstQuote?.dailyCap?.remaining;
    final insufficient = balance < total;
    final overCap =
        lines.any((line) => !line.quote.withinDailyCap) ||
        (capRemaining != null && total > capRemaining);
    final hasOptional = active.any((request) => request.optional);

    final choice = await showDialog<_CostChoice>(
      context: context,
      builder: (context) => _CostDialog(
        title: title,
        currency: currency,
        lines: lines,
        total: total,
        balance: balance,
        insufficient: insufficient,
        overCap: overCap,
        dailyCap: firstQuote?.dailyCap,
        canDropOptional: hasOptional,
        canOpenWallet: onOpenWallet != null,
      ),
    );
    if (!context.mounted) return const CostResult(proceed: false);
    switch (choice) {
      case _CostChoice.confirm:
        return CostResult(proceed: true, droppedOptional: dropped, total: total);
      case _CostChoice.dropOptional:
        active = active.where((request) => !request.optional).toList();
        dropped = true;
        continue;
      case _CostChoice.wallet:
        onOpenWallet?.call();
        return const CostResult(proceed: false);
      case _CostChoice.cancel || null:
        return const CostResult(proceed: false);
    }
  }
}

enum _UnknownCostChoice { retry, continueAnyway, cancel }

class _UnknownCostDialog extends StatelessWidget {
  const _UnknownCostDialog({
    required this.title,
    required this.info,
    required this.canContinue,
    required this.dropsOptional,
  });

  final String title;
  final JobsErrorInfo info;

  /// `false` cuando la acción siempre cobra: no se puede seguir sin ver el costo.
  final bool canContinue;

  /// Al continuar se descarta la parte opcional (la prioridad).
  final bool dropsOptional;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(title),
    content: SingleChildScrollView(
      child: Text(
        'No pudimos consultar el costo de esta acción. ${info.message}\n\n'
        '${canContinue ? dropsOptional ? 'Puedes reintentar o continuar sin la prioridad: la prioridad siempre tiene un costo y no la aplicaremos sin que lo veas. Si lo que queda tiene un costo, se descontará de tu saldo según el catálogo, y no se hará ningún cobro si no alcanza.' : 'Puedes reintentar o continuar de todos modos: si la acción tiene un costo, se descontará de tu saldo según el catálogo, y no se hará ningún cobro si no alcanza.' : 'Esta acción siempre tiene un costo y no la haremos sin mostrártelo. Reintenta cuando tengas conexión. No se cobró nada.'}',
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context, _UnknownCostChoice.cancel),
        child: const Text('Cancelar'),
      ),
      OutlinedButton(
        onPressed: () => Navigator.pop(context, _UnknownCostChoice.retry),
        child: const Text('Reintentar'),
      ),
      if (canContinue)
        FilledButton(
          onPressed: () =>
              Navigator.pop(context, _UnknownCostChoice.continueAnyway),
          child: Text(dropsOptional ? 'Continuar sin prioridad' : 'Continuar'),
        ),
    ],
  );
}

enum _CostChoice { confirm, dropOptional, wallet, cancel }

class _CostDialog extends StatelessWidget {
  const _CostDialog({
    required this.title,
    required this.currency,
    required this.lines,
    required this.total,
    required this.balance,
    required this.insufficient,
    required this.overCap,
    required this.dailyCap,
    required this.canDropOptional,
    required this.canOpenWallet,
  });

  final String title;
  final String currency;
  final List<({CostRequest request, Quote quote})> lines;
  final int total;
  final int balance;
  final bool insufficient;
  final bool overCap;
  final DailyCap? dailyCap;
  final bool canDropOptional;
  final bool canOpenWallet;

  @override
  Widget build(BuildContext context) {
    final blocked = insufficient || overCap;
    final refundHours = lines
        .map((line) => line.quote.refundWindowHours)
        .whereType<int>()
        .fold<int?>(null, (best, value) => best == null || value < best ? value : best);
    return AlertDialog(
      title: Text(title),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final line in lines) ...[
              _Line(
                label: line.request.label,
                value: line.quote.cost <= 0
                    ? 'Gratis'
                    : formatCoins(line.quote.cost, currency),
              ),
              if (line.quote.freeQuota != null &&
                  line.quote.freeQuota!.monthlyLimit > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    '${line.request.actionKey == ActionKeys.applicationExtra ? 'Postulaciones gratuitas' : 'Usos gratuitos'} que te quedan este mes: '
                    '${line.quote.freeQuota!.remaining} de '
                    '${line.quote.freeQuota!.monthlyLimit}.',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
            ],
            const Divider(height: 20),
            _Line(label: 'Total', value: formatCoins(total, currency), bold: true),
            _Line(label: 'Tu saldo', value: formatCoins(balance, currency)),
            if (!blocked)
              _Line(
                label: 'Te quedarían',
                value: formatCoins(balance - total, currency),
              ),
            if (!blocked && refundHours != null) ...[
              const SizedBox(height: 8),
              Text(
                'Si la empresa no responde en $refundHours h, te devolvemos '
                'el costo automáticamente.',
                style: const TextStyle(fontSize: 12),
              ),
            ],
            if (insufficient) ...[
              const SizedBox(height: 10),
              Text(
                'No tienes saldo suficiente: te faltan '
                '${formatCoins(total - balance, currency)}. No se cobró nada.',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ] else if (overCap) ...[
              const SizedBox(height: 10),
              Text(
                'Con este costo superarías tu tope diario de gasto'
                '${dailyCap != null ? ' (hoy gastaste ${formatCoins(dailyCap!.spentToday, currency)} de ${formatCoins(dailyCap!.limit, currency)})' : ''}. '
                'Podrás volver a gastar mañana. No se cobró nada.',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, _CostChoice.cancel),
          child: const Text('Cancelar'),
        ),
        if (blocked && canOpenWallet)
          OutlinedButton(
            onPressed: () => Navigator.pop(context, _CostChoice.wallet),
            child: const Text('Ver mi billetera'),
          ),
        if (blocked && canDropOptional)
          FilledButton(
            onPressed: () => Navigator.pop(context, _CostChoice.dropOptional),
            child: const Text('Continuar sin lo opcional'),
          ),
        if (!blocked)
          FilledButton(
            onPressed: () => Navigator.pop(context, _CostChoice.confirm),
            child: Text('Confirmar y pagar ${formatCoins(total, currency)}'),
          ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value, this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        const SizedBox(width: 12),
        Text(
          value,
          style: TextStyle(fontWeight: bold ? FontWeight.w900 : FontWeight.w700),
        ),
      ],
    ),
  );
}
