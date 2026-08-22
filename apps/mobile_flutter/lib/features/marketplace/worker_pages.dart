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
    final accepted = await widget.repository.acceptShift(shift.id);
    widget.onAccepted(accepted);
    final refreshedShifts = widget.repository.availableShifts();
    setState(() {
      _shifts = refreshedShifts;
    });
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

class HistoryPage extends StatelessWidget {
  const HistoryPage({super.key, required this.repository});

  final WorkerMarketplaceRepository repository;

  @override
  Widget build(BuildContext context) => _WorkerPage(
    title: 'Mis pagos',
    subtitle: 'Tus pagos protegidos y comprobantes',
    child: FutureBuilder<List<PaymentRecord>>(
      future: repository.walletMovements(),
      builder: (context, snapshot) => Column(
        children: [
          ...(snapshot.data ?? paymentHistory).map(
            (payment) => _PaymentTile(payment: payment),
          ),
          const SizedBox(height: 8),
          const _DisabledIntegrationNotice(
            message:
                'Retiros desactivados hasta integrar un proveedor de pagos seguro.',
          ),
        ],
      ),
    ),
  );
}

class CheckInPage extends StatelessWidget {
  const CheckInPage({
    super.key,
    this.activeShift,
    this.capabilities = AppCapabilities.defaults,
  });

  final Shift? activeShift;
  final AppCapabilities capabilities;

  @override
  Widget build(BuildContext context) => _WorkerPage(
    title: 'Check-in de turno',
    subtitle: 'Valida tu asistencia al llegar al lugar',
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration(),
      child: Column(
        children: [
          Icon(
            activeShift == null
                ? Icons.assignment_outlined
                : Icons.qr_code_2_rounded,
            color: AppColors.navy,
            size: 136,
          ),
          const SizedBox(height: 18),
          Text(
            activeShift == null
                ? 'Acepta un turno para obtener tu código'
                : 'Tu código de check-in',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            activeShift?.checkInCredential ??
                'Aún no tienes un turno asignado.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 20),
          if (!capabilities.cameraCheckInEnabled)
            const _DisabledIntegrationNotice(
              message:
                  'Cámara desactivada: esta demostración no solicita permisos ni escanea códigos.',
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
                shift.state == ShiftState.published ? 'Aceptar' : 'Asignado',
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
  const _PaymentTile({required this.payment});
  final PaymentRecord payment;

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
              label: payment.status,
              color: payment.status == 'Liberado'
                  ? AppColors.teal
                  : AppColors.gold,
            ),
          ],
        ),
      ],
    ),
  );
}

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
