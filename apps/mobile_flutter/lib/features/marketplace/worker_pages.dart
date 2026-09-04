import 'package:flutter/material.dart';

import '../../core/formatters/currency_formatter.dart';
import '../../theme/app_theme.dart';
import 'app_capabilities.dart';
import 'marketplace_data.dart';
import 'marketplace_repository.dart';

class ShiftsPage extends StatefulWidget {
  const ShiftsPage({
    super.key,
    required this.repository,
    required this.onAccepted,
  });

  final WorkerMarketplaceRepository repository;
  final ValueChanged<Shift> onAccepted;

  @override
  State<ShiftsPage> createState() => _ShiftsPageState();
}

class _ShiftsPageState extends State<ShiftsPage> {
  late Future<List<Shift>> _shifts;
  var _filter = const ShiftSearchFilter();

  @override
  void initState() {
    super.initState();
    _shifts = widget.repository.availableShifts();
  }

  Future<void> _accept(Shift shift) async {
    final answers = <String, String>{};
    if (shift.screeningQuestions.isNotEmpty) {
      final controllers = {
        for (final question in shift.screeningQuestions)
          question: TextEditingController(),
      };
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Antes de postular'),
          content: SingleChildScrollView(
            child: Column(
              children: controllers.entries
                  .map(
                    (entry) => TextField(
                      controller: entry.value,
                      decoration: InputDecoration(labelText: entry.key),
                      maxLines: 2,
                    ),
                  )
                  .toList(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Continuar'),
            ),
          ],
        ),
      );
      for (final entry in controllers.entries) {
        answers[entry.key] = entry.value.text;
        entry.value.dispose();
      }
      if (confirmed != true) return;
    }
    try {
      await widget.repository.applyToShift(shift.id, answers: answers);
      widget.onAccepted(shift);
      if (mounted)
        setState(() => _shifts = widget.repository.availableShifts());
    } catch (_) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'No pudimos enviar la postulación. Revisa tus respuestas.',
            ),
          ),
        );
    }
  }

  void _updateFilter({
    String? query,
    ShiftIndustry? industry,
    bool clearIndustry = false,
    int? minimumPay,
    bool? urgentOnly,
    bool? recommendedOnly,
  }) {
    setState(() {
      _filter = ShiftSearchFilter(
        query: query ?? _filter.query,
        industry: clearIndustry ? null : industry ?? _filter.industry,
        minimumPayCents: (minimumPay ?? (_filter.minimumPayCents ~/ 100)) * 100,
        urgentOnly: urgentOnly ?? _filter.urgentOnly,
        recommendedOnly: recommendedOnly ?? _filter.recommendedOnly,
      );
    });
  }

  @override
  Widget build(BuildContext context) => _WorkerPage(
    title: 'Turnos recomendados',
    subtitle: 'Encontrados por tu perfil y disponibilidad',
    child: FutureBuilder<List<Shift>>(
      future: _shifts,
      builder: (context, snapshot) {
        final shifts = snapshot.data ?? const <Shift>[];
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            ),
          );
        }
        if (snapshot.hasError) {
          return _WalletState(
            icon: Icons.cloud_off_outlined,
            title: 'No pudimos cargar los turnos',
            message: 'Verifica tu conexión e inténtalo nuevamente.',
            action: () =>
                setState(() => _shifts = widget.repository.availableShifts()),
          );
        }
        final filtered = filterDemoShifts(shifts, _filter);
        return Column(
          children: [
            Semantics(
              label: 'Buscar turnos',
              textField: true,
              child: TextField(
                onChanged: (value) => _updateFilter(query: value),
                decoration: InputDecoration(
                  hintText: 'Buscar por cargo, empresa o distrito',
                  prefixIcon: const Icon(Icons.search_rounded),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilterChip(
                  label: const Text('Urgentes'),
                  selected: _filter.urgentOnly,
                  onSelected: (value) => _updateFilter(urgentOnly: value),
                ),
                FilterChip(
                  label: const Text('Recomendados'),
                  selected: _filter.recommendedOnly,
                  onSelected: (value) => _updateFilter(recommendedOnly: value),
                ),
                DropdownButton<int>(
                  value: _filter.minimumPayCents ~/ 100,
                  items: const [
                    DropdownMenuItem(value: 0, child: Text('Cualquier pago')),
                    DropdownMenuItem(value: 90, child: Text('Desde S/ 90')),
                    DropdownMenuItem(value: 110, child: Text('Desde S/ 110')),
                  ],
                  onChanged: (value) => _updateFilter(minimumPay: value),
                ),
                if (_filter.hasActiveFilters)
                  TextButton.icon(
                    onPressed: () =>
                        setState(() => _filter = const ShiftSearchFilter()),
                    icon: const Icon(Icons.restart_alt_rounded),
                    label: const Text('Limpiar'),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            if (filtered.isEmpty)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Text('No encontramos turnos con esos filtros.'),
              )
            else
              ...filtered.map(
                (shift) =>
                    _ShiftCard(shift: shift, onAccept: () => _accept(shift)),
              ),
          ],
        );
      },
    ),
  );
}

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key, required this.repository});

  final WorkerMarketplaceRepository repository;

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  late Future<List<PaymentRecord>> _movements;

  @override
  void initState() {
    super.initState();
    _movements = widget.repository.walletMovements();
  }

  void _retry() {
    setState(() => _movements = widget.repository.walletMovements());
  }

  @override
  Widget build(BuildContext context) => _WorkerPage(
    title: 'Mis pagos',
    subtitle: 'Consulta el monto y la referencia que reportó la empresa',
    child: FutureBuilder<List<PaymentRecord>>(
      future: _movements,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            ),
          );
        }
        if (snapshot.hasError) {
          return _WalletState(
            icon: Icons.cloud_off_outlined,
            title: 'No pudimos cargar tus movimientos',
            message: 'Verifica tu conexión e inténtalo nuevamente.',
            action: _retry,
          );
        }
        final movements = snapshot.data ?? const <PaymentRecord>[];
        return Column(
          children: [
            if (movements.isEmpty)
              const _WalletState(
                icon: Icons.receipt_long_outlined,
                title: 'Aún no tienes pagos registrados',
                message:
                    'Cuando completes un turno, la empresa podrá reportar aquí el pago y su comprobante.',
              )
            else
              ...movements.map(
                (payment) => _PaymentTile(
                  payment: payment,
                  onConfirm:
                      payment.id != null &&
                          payment.status == 'Liberado' &&
                          !payment.receiptConfirmed
                      ? () async {
                          try {
                            await widget.repository.confirmPayment(payment.id!);
                            if (!mounted) return;
                            _retry();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Recepción del pago confirmada.'),
                              ),
                            );
                          } catch (_) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'No pudimos confirmar el pago.',
                                  ),
                                ),
                              );
                            }
                          }
                        }
                      : null,
                ),
              ),
            const SizedBox(height: 8),
            const _DisabledIntegrationNotice(
              message:
                  'CumpleNow no administra tu dinero: la empresa te paga directamente y aquí conservamos el registro.',
            ),
          ],
        );
      },
    ),
  );
}

class _WalletState extends StatelessWidget {
  const _WalletState({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? action;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(28),
    decoration: _cardDecoration(),
    child: Column(
      children: [
        Icon(icon, size: 42, color: AppColors.muted),
        const SizedBox(height: 10),
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.muted, fontSize: 13),
        ),
        if (action != null) ...[
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: action,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Reintentar'),
          ),
        ],
      ],
    ),
  );
}

class CheckInPage extends StatelessWidget {
  const CheckInPage({
    super.key,
    this.activeShift,
    this.capabilities = AppCapabilities.defaults,
    this.repository,
  });

  final Shift? activeShift;
  final AppCapabilities capabilities;
  final WorkerMarketplaceRepository? repository;

  @override
  Widget build(BuildContext context) => _WorkerPage(
    title: 'Asistencia del turno',
    subtitle: 'Registra tu llegada y salida desde tu postulación',
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration(),
      child: Column(
        children: [
          Icon(
            activeShift == null
                ? Icons.assignment_outlined
                : Icons.event_available_outlined,
            color: AppColors.navy,
            size: 136,
          ),
          const SizedBox(height: 18),
          Text(
            activeShift == null
                ? 'Acepta un turno para registrar tu asistencia'
                : 'Tu turno está listo',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            activeShift == null
                ? 'Aún no tienes un turno asignado.'
                : '${activeShift!.title} · ${activeShift!.schedule}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 20),
          if (activeShift != null && repository != null)
            FilledButton.icon(
              onPressed: () async {
                try {
                  if (activeShift!.checkedIn) {
                    await repository!.checkOut(activeShift!.id);
                  } else {
                    final credential = activeShift!.checkInCredential;
                    if (credential == null || credential.isEmpty) {
                      throw StateError('CREDENCIAL_NO_DISPONIBLE');
                    }
                    await repository!.checkIn(activeShift!.id, credential);
                  }
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          activeShift!.checkedIn
                              ? 'Salida registrada correctamente.'
                              : 'Llegada registrada correctamente.',
                        ),
                      ),
                    );
                  }
                } catch (_) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('No pudimos registrar la asistencia.'),
                      ),
                    );
                  }
                }
              },
              icon: Icon(
                activeShift!.checkedIn
                    ? Icons.logout_rounded
                    : Icons.login_rounded,
              ),
              label: Text(
                activeShift!.checkedIn
                    ? 'Registrar salida'
                    : 'Confirmar llegada',
              ),
            )
          else if (!capabilities.cameraCheckInEnabled)
            const _DisabledIntegrationNotice(
              message:
                  'Cámara desactivada: la asistencia se registra desde “Mis postulaciones”. Confirma tu llegada al iniciar el turno y tu salida al terminar.',
            )
          else
            FilledButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('Abrir cámara'),
            ),
          const SizedBox(height: 10),
          if (!capabilities.locationCheckInEnabled)
            const _DisabledIntegrationNotice(
              message:
                  'Ubicación desactivada: no recopilamos tu GPS durante la demostración.',
            ),
        ],
      ),
    ),
  );
}

class RewardsPage extends StatelessWidget {
  const RewardsPage({super.key});

  @override
  Widget build(BuildContext context) => _WorkerPage(
    title: 'Logros y beneficios',
    subtitle: 'Tu reputación abre nuevas oportunidades',
    child: Column(
      children: const [
        _RewardTile(
          icon: Icons.workspace_premium_outlined,
          color: AppColors.gold,
          title: 'Puntual Pro',
          subtitle: '100% de entradas a tiempo',
        ),
        _RewardTile(
          icon: Icons.handshake_outlined,
          color: AppColors.teal,
          title: 'Fidelidad Oro',
          subtitle: '5 turnos con la misma empresa',
        ),
        _RewardTile(
          icon: Icons.bolt_rounded,
          color: Color(0xFF7C3AED),
          title: 'Reemplazante IA',
          subtitle: 'Cubriste un turno urgente',
        ),
      ],
    ),
  );
}

class _WorkerPage extends StatelessWidget {
  const _WorkerPage({
    required this.title,
    required this.subtitle,
    required this.child,
  });
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: Colors.transparent,
      title: Text(
        title,
        style: const TextStyle(
          color: AppColors.navy,
          fontWeight: FontWeight.w800,
        ),
      ),
      centerTitle: false,
    ),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 96),
      children: [
        Text(
          subtitle,
          style: const TextStyle(color: AppColors.muted, fontSize: 13),
        ),
        const SizedBox(height: 20),
        child,
      ],
    ),
  );
}

class _ShiftCard extends StatelessWidget {
  const _ShiftCard({required this.shift, required this.onAccept});
  final Shift shift;
  final VoidCallback onAccept;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(16),
    decoration: _cardDecoration(),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                shift.title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (shift.urgent) _Pill(label: 'URGENTE', color: Colors.red),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          shift.company,
          style: const TextStyle(color: AppColors.muted, fontSize: 13),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            const Icon(
              Icons.schedule_outlined,
              size: 16,
              color: AppColors.teal,
            ),
            const SizedBox(width: 5),
            Text(
              shift.schedule,
              style: const TextStyle(
                color: AppColors.navy,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        const Divider(height: 25),
        Row(
          children: [
            Text(
              formatPenCents(shift.workerPayCents),
              style: const TextStyle(
                color: AppColors.teal,
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            const Spacer(),
            _Pill(
              label: shift.state == ShiftState.assigned
                  ? 'ASIGNADO'
                  : '${shift.match}% MATCH',
              color: shift.state == ShiftState.assigned
                  ? AppColors.gold
                  : AppColors.teal,
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: shift.state == ShiftState.published ? onAccept : null,
              child: Text(
                shift.state == ShiftState.published ? 'Postular' : 'Asignado',
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _DisabledIntegrationNotice extends StatelessWidget {
  const _DisabledIntegrationNotice({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: AppColors.tealSoft,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(
      message,
      textAlign: TextAlign.center,
      style: const TextStyle(color: AppColors.navy, fontSize: 12),
    ),
  );
}

class _PaymentTile extends StatelessWidget {
  const _PaymentTile({required this.payment, this.onConfirm});
  final PaymentRecord payment;
  final VoidCallback? onConfirm;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(15),
    decoration: _cardDecoration(),
    child: Row(
      children: [
        const CircleAvatar(
          backgroundColor: AppColors.tealSoft,
          child: Icon(
            Icons.account_balance_wallet_outlined,
            color: AppColors.teal,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                payment.company,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              Text(
                payment.role,
                style: const TextStyle(color: AppColors.muted, fontSize: 11),
              ),
              if (payment.reference != null && payment.reference!.isNotEmpty)
                Text(
                  'Referencia: ${payment.reference}',
                  style: const TextStyle(color: AppColors.muted, fontSize: 10),
                ),
            ],
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              payment.amount,
              style: const TextStyle(
                color: AppColors.navy,
                fontWeight: FontWeight.w800,
              ),
            ),
            _Pill(
              label: _paymentStatusLabel(payment.status),
              color: payment.status == 'Liberado'
                  ? AppColors.teal
                  : payment.status == 'Reversed'
                  ? Colors.redAccent
                  : AppColors.gold,
            ),
            if (onConfirm != null)
              TextButton(
                onPressed: onConfirm,
                style: TextButton.styleFrom(
                  minimumSize: Size.zero,
                  padding: const EdgeInsets.only(top: 5),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Confirmar recepción'),
              )
            else if (payment.receiptConfirmed)
              const Text(
                'Recepción confirmada',
                style: TextStyle(color: AppColors.teal, fontSize: 10),
              ),
          ],
        ),
      ],
    ),
  );
}

String _paymentStatusLabel(String status) => switch (status) {
  'Liberado' => 'Pago reportado',
  'Reversed' => 'Incidencia de pago',
  _ => 'Pendiente de pago',
};

class _RewardTile extends StatelessWidget {
  const _RewardTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
  });
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 11),
    padding: const EdgeInsets.all(15),
    decoration: _cardDecoration(),
    child: Row(
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: color.withValues(alpha: .12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: color),
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              Text(
                subtitle,
                style: const TextStyle(color: AppColors.muted, fontSize: 11),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

BoxDecoration _cardDecoration() => BoxDecoration(
  color: Colors.white,
  border: Border.all(color: AppColors.border),
  borderRadius: BorderRadius.circular(16),
);

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .12),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Text(
      label,
      style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 8),
    ),
  );
}
