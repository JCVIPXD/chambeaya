import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../discovery/discovery_models.dart';
import 'marketplace_data.dart';
import 'marketplace_repository.dart';

class WorkerApplicationsPage extends StatelessWidget {
  const WorkerApplicationsPage({super.key, required this.repository});

  final WorkerMarketplaceRepository repository;

  @override
  Widget build(BuildContext context) => _SecondaryPage(
    title: 'Mis postulaciones',
    subtitle: 'Sigue cada proceso sin perder ninguna actualización',
    child: FutureBuilder<_ApplicationsData>(
      future: _load(),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final data = snapshot.data;
        if (data == null || data.states.isEmpty) {
          return const _ApplicationsEmpty();
        }
        return Column(
          children: data.states.entries.map((entry) {
            final shift = data.shifts
                .where((item) => item.id == entry.key)
                .firstOrNull;
            if (shift == null) return const SizedBox.shrink();
            final presentation = _applicationPresentation(entry.value);
            return _ApplicationCard(
              company: shift.company,
              role: shift.title,
              status: presentation.label,
              statusColor: presentation.color,
              progress: presentation.progress,
              nextStep: presentation.nextStep,
            );
          }).toList(),
        );
      },
    ),
  );

  Future<_ApplicationsData> _load() async {
    final shiftsFuture = repository.availableShifts();
    final statesFuture = repository.applicationStates();
    return _ApplicationsData(
      shifts: await shiftsFuture,
      states: await statesFuture,
    );
  }
}

class _ApplicationsData {
  const _ApplicationsData({required this.shifts, required this.states});
  final List<Shift> shifts;
  final Map<String, ApplicationState> states;
}

({String label, Color color, double progress, String nextStep})
_applicationPresentation(ApplicationState state) => switch (state) {
  ApplicationState.submitted => (
    label: 'Postulación enviada',
    color: const Color(0xFF4F46E5),
    progress: .3,
    nextStep: 'La empresa recibió tu perfil correctamente',
  ),
  ApplicationState.reviewing => (
    label: 'En revisión',
    color: AppColors.gold,
    progress: .55,
    nextStep: 'La empresa está revisando tu experiencia',
  ),
  ApplicationState.accepted => (
    label: 'Seleccionado',
    color: AppColors.teal,
    progress: 1,
    nextStep: 'Revisa los detalles y confirma tu turno',
  ),
  ApplicationState.closed => (
    label: 'Proceso cerrado',
    color: AppColors.muted,
    progress: 1,
    nextStep: 'Puedes seguir buscando nuevas oportunidades',
  ),
  ApplicationState.notApplied => (
    label: 'Sin postular',
    color: AppColors.muted,
    progress: 0,
    nextStep: 'Completa tu postulación para continuar',
  ),
};

class _ApplicationsEmpty extends StatelessWidget {
  const _ApplicationsEmpty();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(28),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: const Column(
      children: [
        Icon(Icons.work_history_outlined, color: AppColors.teal, size: 44),
        SizedBox(height: 12),
        Text(
          'Aún no tienes postulaciones',
          style: TextStyle(color: AppColors.navy, fontWeight: FontWeight.w800),
        ),
        SizedBox(height: 6),
        Text(
          'Explora oportunidades y postula al turno que mejor encaje contigo.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.muted),
        ),
      ],
    ),
  );
}

class WorkerMessagesPage extends StatelessWidget {
  const WorkerMessagesPage({super.key});

  @override
  Widget build(BuildContext context) => _SecondaryPage(
    title: 'Conversaciones',
    subtitle: 'Comunicación directa y segura con empresas verificadas',
    trailing: IconButton.filledTonal(
      tooltip: 'Nuevo mensaje',
      onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Selecciona una empresa para iniciar una conversación.',
          ),
        ),
      ),
      icon: const Icon(Icons.edit_square),
    ),
    child: Column(
      children: const [
        _ConversationTile(
          initials: 'LM',
          company: 'Restaurante La Mar',
          message: 'Gracias por postular. Revisaremos tu perfil hoy.',
          time: '10:24',
          unread: 2,
        ),
        _ConversationTile(
          initials: 'HM',
          company: 'Hotel Miraflores Park',
          message: 'Tu entrevista quedó confirmada para mañana.',
          time: 'Ayer',
        ),
        _ConversationTile(
          initials: 'EP',
          company: 'Eventos Perú',
          message: 'Turno finalizado. El pago se encuentra protegido.',
          time: 'Lun',
        ),
      ],
    ),
  );
}

class _SecondaryPage extends StatelessWidget {
  const _SecondaryPage({
    required this.title,
    required this.subtitle,
    required this.child,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.background,
    child: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 920),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 110),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.navy,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  ?trailing,
                ],
              ),
              const SizedBox(height: 6),
              Text(
                subtitle,
                style: const TextStyle(color: AppColors.muted, fontSize: 14),
              ),
              const SizedBox(height: 24),
              child,
            ],
          ),
        ),
      ),
    ),
  );
}

class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({
    required this.company,
    required this.role,
    required this.status,
    required this.statusColor,
    required this.progress,
    required this.nextStep,
  });
  final String company;
  final String role;
  final String status;
  final Color statusColor;
  final double progress;
  final String nextStep;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 14),
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: AppColors.tealSoft,
              child: Text(
                company.substring(0, 1),
                style: const TextStyle(
                  color: AppColors.teal,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(role, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 3),
                  Text(
                    company,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text(
                status,
                style: TextStyle(
                  color: statusColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 7,
            backgroundColor: AppColors.border,
            color: statusColor,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            const Icon(
              Icons.next_plan_outlined,
              size: 17,
              color: AppColors.teal,
            ),
            const SizedBox(width: 7),
            Expanded(
              child: Text(
                nextStep,
                style: const TextStyle(
                  color: AppColors.navy,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({
    required this.initials,
    required this.company,
    required this.message,
    required this.time,
    this.unread = 0,
  });
  final String initials;
  final String company;
  final String message;
  final String time;
  final int unread;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: AppColors.border),
        borderRadius: BorderRadius.circular(15),
      ),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        onTap: () => ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Vista previa del chat con $company')),
        ),
        leading: CircleAvatar(
          backgroundColor: AppColors.tealSoft,
          child: Text(
            initials,
            style: const TextStyle(
              color: AppColors.teal,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        title: Text(
          company,
          style: const TextStyle(
            color: AppColors.navy,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(message, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              time,
              style: const TextStyle(color: AppColors.muted, fontSize: 10),
            ),
            if (unread > 0) ...[
              const SizedBox(height: 5),
              CircleAvatar(
                radius: 10,
                backgroundColor: AppColors.teal,
                child: Text(
                  '$unread',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    ),
  );
}
