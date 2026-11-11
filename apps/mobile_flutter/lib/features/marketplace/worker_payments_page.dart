import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'marketplace_data.dart';
import 'marketplace_repository.dart';

/// Pantalla de solo lectura "Mis pagos" (Alcance D: registro confiable y
/// modo manual). Accesible desde Perfil. Reusa
/// `WorkerMarketplaceRepository.walletMovements()`/`PaymentRecord` y
/// `confirmPayment()` — los mismos que ya usaba el resto de la app, ninguna
/// pantalla los mostraba hasta ahora (la anterior se eliminó como código
/// muerto).
///
/// Nunca deriva el estado a partir de `provider`: ese campo nunca llega a
/// este DTO (ver `apps/api/tests/marketplace.no-commission-leak.test.ts`).
/// El único booleano que decide si se puede confirmar la recepción es
/// `PaymentRecord.canConfirmReceipt`, ya calculado por la API.
class WorkerPaymentsPage extends StatefulWidget {
  const WorkerPaymentsPage({required this.repository, super.key});

  final WorkerMarketplaceRepository repository;

  @override
  State<WorkerPaymentsPage> createState() => _WorkerPaymentsPageState();
}

class _WorkerPaymentsPageState extends State<WorkerPaymentsPage> {
  late Future<List<PaymentRecord>> _payments;
  String? _confirmingId;

  @override
  void initState() {
    super.initState();
    _payments = widget.repository.walletMovements();
  }

  void _retry() {
    setState(() {
      _payments = widget.repository.walletMovements();
    });
  }

  Future<void> _confirmReceipt(PaymentRecord payment) async {
    final id = payment.id;
    if (id == null || _confirmingId != null) return;
    setState(() => _confirmingId = id);
    try {
      await widget.repository.confirmPayment(id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Recepción confirmada.')),
      );
      setState(() {
        _confirmingId = null;
        // La fuente de verdad es la API: se recarga la lista completa en
        // vez de mutar la fila localmente, para reflejar cualquier otro
        // cambio que haya ocurrido mientras tanto.
        _payments = widget.repository.walletMovements();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _confirmingId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No pudimos confirmar la recepción. Inténtalo otra vez.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: context.palette.background,
    appBar: AppBar(
      title: const Text('Mis pagos'),
      backgroundColor: context.palette.background,
      foregroundColor: context.palette.ink,
      elevation: 0,
    ),
    body: SafeArea(
      child: FutureBuilder<List<PaymentRecord>>(
        future: _payments,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _PaymentsFailure(onRetry: _retry);
          }
          final payments = snapshot.data ?? const <PaymentRecord>[];
          if (payments.isEmpty) {
            return const _PaymentsEmpty();
          }
          return RefreshIndicator(
            onRefresh: () async {
              final next = widget.repository.walletMovements();
              setState(() => _payments = next);
              await next;
            },
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              itemCount: payments.length,
              itemBuilder: (context, index) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _PaymentCard(
                  payment: payments[index],
                  confirming: _confirmingId == payments[index].id,
                  onConfirm: () => _confirmReceipt(payments[index]),
                ),
              ),
            ),
          );
        },
      ),
    ),
  );
}

/// Los tres estados que ve el trabajador (ninguno depende de `provider`):
/// "Pendiente de pago" (todavía no llega a `PROCESSED`), "Pagado" (ya
/// `PROCESSED`, esperando que el trabajador confirme la recepción, o un
/// pago sin esa opción -por ejemplo de una pasarela futura, Alcance E-) y
/// "Recepción confirmada" (`receiptConfirmed`).
String _statusLabel(PaymentRecord payment) {
  if (payment.receiptConfirmed) return 'Recepción confirmada';
  if (payment.status == 'Pendiente') return 'Pendiente de pago';
  if (payment.status == 'Revertido') return 'Cancelado';
  return 'Pagado';
}

Color _statusColor(BuildContext context, PaymentRecord payment) {
  if (payment.receiptConfirmed) return AppColors.tealDark;
  if (payment.status == 'Pendiente') return context.palette.muted;
  if (payment.status == 'Revertido') return Colors.red;
  return AppColors.navy;
}

const _monthAbbreviations = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/// Formatea la fecha ISO cruda que trae `PaymentRecord.date` (ver
/// `http_worker_marketplace_repository.dart`). Sin `intl` (no es una
/// dependencia de este proyecto): solo día, mes abreviado y año.
String? _formatDate(String? iso) {
  if (iso == null) return null;
  final date = DateTime.tryParse(iso);
  if (date == null) return null;
  final local = date.toLocal();
  return '${local.day} ${_monthAbbreviations[local.month - 1]} ${local.year}';
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({
    required this.payment,
    required this.confirming,
    required this.onConfirm,
  });

  final PaymentRecord payment;
  final bool confirming;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final date = _formatDate(payment.date);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    payment.company,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  payment.amount,
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: _statusColor(context, payment).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _statusLabel(payment),
                    style: TextStyle(
                      color: _statusColor(context, payment),
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ),
                if (date != null) ...[
                  const SizedBox(width: 8),
                  Text(
                    date,
                    style: TextStyle(color: context.palette.muted, fontSize: 12),
                  ),
                ],
              ],
            ),
            if (payment.canConfirmReceipt) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: confirming ? null : onConfirm,
                  child: confirming
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Confirmar recepción'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PaymentsEmpty extends StatelessWidget {
  const _PaymentsEmpty();

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.payments_outlined,
            size: 42,
            color: context.palette.muted,
          ),
          const SizedBox(height: 12),
          Text(
            'Todavía no tienes pagos',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          const Text(
            'Cuando completes un turno, el pago pendiente aparecerá aquí.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    ),
  );
}

class _PaymentsFailure extends StatelessWidget {
  const _PaymentsFailure({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.cloud_off_outlined,
            size: 42,
            color: context.palette.muted,
          ),
          const SizedBox(height: 12),
          Text(
            'No pudimos cargar tus pagos',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          const Text(
            'Revisa tu conexión e inténtalo nuevamente.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: onRetry, child: const Text('Reintentar')),
        ],
      ),
    ),
  );
}
