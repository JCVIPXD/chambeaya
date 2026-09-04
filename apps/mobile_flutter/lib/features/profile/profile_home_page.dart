import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/app_theme.dart';
import 'profile_data.dart';
import '../marketplace/marketplace_data.dart';
import '../marketplace/marketplace_repository.dart';
import '../marketplace/worker_pages.dart';

class ProfileHomePage extends StatelessWidget {
  const ProfileHomePage({
    this.showNavigation = true,
    this.onLogout,
    this.repository,
    this.workerName,
    super.key,
  });
  final bool showNavigation;
  final VoidCallback? onLogout;
  final WorkerMarketplaceRepository? repository;
  final String? workerName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _TopBar(onLogout: onLogout)),
            SliverToBoxAdapter(child: _ProfileHeader(workerName: workerName)),
            SliverToBoxAdapter(child: _Strengths()),
            SliverToBoxAdapter(child: _QuickAccess(repository: repository)),
            SliverToBoxAdapter(
              child: _SectionHeader(
                title: 'Estudios y Certificados',
                action: 'Ver todos',
                onTap: () => _showCertificates(context),
              ),
            ),
            SliverToBoxAdapter(child: _Certificates()),
            SliverToBoxAdapter(
              child: _SectionHeader(
                title: 'Historial de Experiencia',
                action: 'Ver historial',
                onTap: () => _showHistory(context),
              ),
            ),
            SliverToBoxAdapter(child: _ExperienceTimeline()),
            const SliverToBoxAdapter(child: SizedBox(height: 94)),
          ],
        ),
      ),
      bottomNavigationBar: showNavigation ? const _NavigationBar() : null,
    );
  }

  void _showCertificates(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    builder: (_) => const _CertificatesSheet(),
  );
  void _showHistory(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _HistorySheet(repository: repository),
  );
}

class _TopBar extends StatelessWidget {
  const _TopBar({this.onLogout});

  final VoidCallback? onLogout;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        IconButton(
          tooltip: onLogout == null ? 'Menú' : 'Cerrar sesión',
          onPressed: onLogout ?? () {},
          icon: Icon(
            onLogout == null ? Icons.menu_rounded : Icons.logout_rounded,
            color: AppColors.navy,
          ),
        ),
        IconButton(
          tooltip: 'Copiar enlace del perfil',
          onPressed: () async {
            await Clipboard.setData(
              const ClipboardData(text: 'https://cumple.now/perfil/demo'),
            );
            if (context.mounted)
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Enlace del perfil copiado.')),
              );
          },
          icon: const Icon(Icons.ios_share_rounded, color: AppColors.navy),
        ),
      ],
    ),
  );
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({this.workerName});
  final String? workerName;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Stack(
          children: [
            const CircleAvatar(
              radius: 42,
              backgroundColor: Color(0xFFDCE6ED),
              child: Text(
                'AG',
                style: TextStyle(
                  color: AppColors.navy,
                  fontWeight: FontWeight.w800,
                  fontSize: 25,
                ),
              ),
            ),
            Positioned(
              right: 2,
              bottom: 2,
              child: Container(
                height: 18,
                width: 18,
                decoration: BoxDecoration(
                  color: AppColors.teal,
                  border: Border.all(color: Colors.white, width: 2),
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                workerName?.trim().isNotEmpty == true
                    ? workerName!
                    : workerProfile.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 3),
              Text(
                workerProfile.role,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 11,
                  height: 1.25,
                ),
              ),
              const SizedBox(height: 5),
              const Row(
                children: [
                  Icon(
                    Icons.location_on_outlined,
                    color: AppColors.muted,
                    size: 13,
                  ),
                  SizedBox(width: 3),
                  Text(
                    'Lima, Perú',
                    style: TextStyle(color: AppColors.muted, fontSize: 11),
                  ),
                ],
              ),
              const SizedBox(height: 3),
              Row(
                children: [
                  const Icon(
                    Icons.star_rounded,
                    color: AppColors.gold,
                    size: 14,
                  ),
                  const SizedBox(width: 3),
                  Flexible(
                    child: Text(
                      '${workerProfile.rating} (128 evaluaciones)',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 7),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.tealSoft,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Disponible hoy',
                  style: TextStyle(
                    color: AppColors.teal,
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        _ScoreRing(score: workerProfile.score),
      ],
    ),
  );
}

class _ScoreRing extends StatelessWidget {
  const _ScoreRing({required this.score});
  final int score;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 87,
    height: 87,
    child: Stack(
      alignment: Alignment.center,
      children: [
        SizedBox(
          width: 87,
          height: 87,
          child: CircularProgressIndicator(
            value: score / 100,
            strokeWidth: 7,
            backgroundColor: const Color(0xFFDCE8ED),
            color: AppColors.teal,
          ),
        ),
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '$score%',
              style: const TextStyle(
                color: AppColors.navy,
                fontSize: 21,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              profileCompletionLabel(score),
              style: const TextStyle(color: AppColors.muted, fontSize: 8),
            ),
          ],
        ),
      ],
    ),
  );
}

class _Strengths extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 25, 20, 0),
    child: Row(
      children: profileStrengths
          .map(
            (strength) => Expanded(
              child: Padding(
                padding: EdgeInsets.only(
                  right: strength == profileStrengths.last ? 0 : 8,
                ),
                child: _StrengthCard(strength: strength),
              ),
            ),
          )
          .toList(),
    ),
  );
}

class _QuickAccess extends StatelessWidget {
  const _QuickAccess({this.repository});
  final WorkerMarketplaceRepository? repository;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
    child: Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _QuickAccessButton(
          label: 'Mis pagos',
          icon: Icons.account_balance_wallet_outlined,
          onTap: repository == null
              ? null
              : () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => HistoryPage(repository: repository!),
                ),
        ),
        _QuickAccessButton(
          label: 'Check-in',
          icon: Icons.qr_code_2_rounded,
          onTap: repository == null
              ? null
              : () async {
                  try {
                    final shift = await repository!.activeShift();
                    if (context.mounted)
                      showModalBottomSheet<void>(
                        context: context,
                        isScrollControlled: true,
                        builder: (_) => CheckInPage(
                          activeShift: shift,
                          repository: repository,
                        ),
                      );
                  } catch (_) {
                    if (context.mounted)
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('No pudimos cargar tu turno activo.'),
                        ),
                      );
                  }
                },
        ),
        _QuickAccessButton(
          label: 'Logros',
          icon: Icons.workspace_premium_outlined,
          onTap: () => showModalBottomSheet<void>(
            context: context,
            builder: (_) => const RewardsPage(),
          ),
        ),
      ],
    ),
  );
}

class _QuickAccessButton extends StatelessWidget {
  const _QuickAccessButton({
    required this.label,
    required this.icon,
    this.onTap,
  });
  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    onPressed: onTap,
    icon: Icon(icon, size: 17),
    label: Text(label),
  );
}

class _CertificatesSheet extends StatelessWidget {
  const _CertificatesSheet();
  @override
  Widget build(BuildContext context) => SafeArea(
    child: ListView(
      padding: const EdgeInsets.all(20),
      shrinkWrap: true,
      children: [
        Text(
          'Todos tus certificados',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 12),
        ...certificates.map(
          (item) => ListTile(
            leading: const Icon(Icons.workspace_premium_outlined),
            title: Text(item.title),
            subtitle: Text('Emitido en ${item.year}'),
          ),
        ),
      ],
    ),
  );
}

class _HistorySheet extends StatelessWidget {
  const _HistorySheet({this.repository});
  final WorkerMarketplaceRepository? repository;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
      child: repository == null
          ? const _HistoryEmpty(
              message: 'Inicia sesión para consultar tus turnos completados.',
            )
          : FutureBuilder<List<Shift>>(
              future: repository!.completedShifts(),
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const SizedBox(
                    height: 180,
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snapshot.hasError) {
                  return const _HistoryEmpty(
                    message:
                        'No pudimos cargar tu historial. Inténtalo nuevamente.',
                  );
                }
                final shifts = snapshot.data ?? const <Shift>[];
                if (shifts.isEmpty) {
                  return const _HistoryEmpty(
                    message: 'Cuando completes tu primer turno aparecerá aquí.',
                  );
                }
                final total = shifts.fold<int>(
                  0,
                  (sum, shift) => sum + shift.workerPayCents,
                );
                return ListView(
                  shrinkWrap: true,
                  children: [
                    Text(
                      'Historial de trabajos',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${shifts.length} turno${shifts.length == 1 ? '' : 's'} completado${shifts.length == 1 ? '' : 's'} · S/ ${(total / 100).toStringAsFixed(2)} generados',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 16),
                    ...shifts.map(
                      (shift) => Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                          side: const BorderSide(color: AppColors.border),
                        ),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 5,
                          ),
                          leading: const CircleAvatar(
                            backgroundColor: AppColors.tealSoft,
                            child: Icon(
                              Icons.check_rounded,
                              color: AppColors.teal,
                            ),
                          ),
                          title: Text(shift.title),
                          subtitle: Text(
                            '${shift.company}\n${shift.schedule} · ${shift.location}',
                          ),
                          isThreeLine: true,
                          trailing: Text(
                            'S/ ${(shift.workerPayCents / 100).toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: AppColors.navy,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
    ),
  );
}

class _HistoryEmpty extends StatelessWidget {
  const _HistoryEmpty({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 180,
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.work_history_outlined,
            color: AppColors.teal,
            size: 38,
          ),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ],
      ),
    ),
  );
}

class _StrengthCard extends StatelessWidget {
  const _StrengthCard({required this.strength});
  final ProfileStrength strength;

  IconData get _icon => switch (strength.icon) {
    'schedule' => Icons.schedule_rounded,
    'verified' => Icons.verified_user_outlined,
    _ => Icons.person_outline_rounded,
  };

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 104),
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: AppColors.tealSoft,
            borderRadius: BorderRadius.circular(9),
          ),
          child: Icon(_icon, color: AppColors.teal, size: 20),
        ),
        const SizedBox(height: 6),
        Text(
          strength.label,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: AppColors.navy,
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          strength.emphasis,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.navy, fontSize: 9),
        ),
      ],
    ),
  );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.action, this.onTap});
  final String title;
  final String action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 28, 20, 13),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: TextButton(
            onPressed: onTap,
            child: Text(
              action,
              textAlign: TextAlign.end,
              style: const TextStyle(
                color: AppColors.teal,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

class _Certificates extends StatelessWidget {
  @override
  Widget build(BuildContext context) => SizedBox(
    height: 164,
    child: ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      itemCount: certificates.length,
      separatorBuilder: (_, _) => const SizedBox(width: 10),
      itemBuilder: (_, index) =>
          _CertificateCard(certificate: certificates[index]),
    ),
  );
}

class _CertificateCard extends StatelessWidget {
  const _CertificateCard({required this.certificate});
  final CertificatePreview certificate;

  @override
  Widget build(BuildContext context) => Container(
    width: 132,
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(11),
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 78,
          color: const Color(0xFFF0E7DA),
          alignment: Alignment.center,
          child: const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.workspace_premium_outlined,
                color: AppColors.navy,
                size: 28,
              ),
              Text(
                'CERTIFICADO',
                style: TextStyle(
                  color: AppColors.navy,
                  fontSize: 8,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(9, 8, 9, 0),
          child: Text(
            certificate.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.navy,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              height: 1.2,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(9, 3, 9, 0),
          child: Text(
            certificate.year,
            style: const TextStyle(color: AppColors.muted, fontSize: 9),
          ),
        ),
      ],
    ),
  );
}

class _ExperienceTimeline extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Container(
    color: Colors.white,
    child: Column(
      children: experiences
          .map((experience) => _ExperienceRow(experience: experience))
          .toList(),
    ),
  );
}

class _ExperienceRow extends StatelessWidget {
  const _ExperienceRow({required this.experience});
  final Experience experience;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(24, 13, 16, 13),
    child: Row(
      children: [
        Column(
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: const BoxDecoration(
                color: AppColors.teal,
                shape: BoxShape.circle,
              ),
            ),
            Container(width: 1, height: 48, color: const Color(0xFFAEECE2)),
          ],
        ),
        const SizedBox(width: 9),
        CircleAvatar(
          radius: 22,
          backgroundColor: AppColors.navy,
          child: Text(
            experience.initial,
            style: const TextStyle(
              fontFamily: 'serif',
              color: Colors.white,
              fontSize: 26,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                experience.company,
                style: const TextStyle(
                  color: AppColors.navy,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                experience.position,
                style: const TextStyle(color: AppColors.muted, fontSize: 10),
              ),
              const SizedBox(height: 3),
              Text(
                experience.period,
                style: const TextStyle(color: AppColors.muted, fontSize: 10),
              ),
            ],
          ),
        ),
        if (experience == experiences.first)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.tealSoft,
              borderRadius: BorderRadius.circular(7),
            ),
            child: const Text(
              'Pago completado',
              style: TextStyle(
                color: AppColors.teal,
                fontSize: 8,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
      ],
    ),
  );
}

class _NavigationBar extends StatelessWidget {
  const _NavigationBar();

  @override
  Widget build(BuildContext context) {
    const entries = [
      (Icons.home_outlined, 'Inicio'),
      (Icons.search_rounded, 'Buscar'),
      (Icons.business_center_outlined, 'Mis Trabajos'),
      (Icons.chat_bubble_outline_rounded, 'Mensajes'),
      (Icons.person_outline_rounded, 'Perfil'),
    ];
    return Container(
      height: 73,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: entries.indexed.map((item) {
          final entry = item.$2;
          final selected = entry.$2 == 'Perfil';
          return SizedBox(
            width: 65,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  entry.$1,
                  color: selected ? AppColors.teal : AppColors.muted,
                  size: 21,
                ),
                const SizedBox(height: 3),
                Text(
                  entry.$2,
                  style: TextStyle(
                    color: selected ? AppColors.teal : AppColors.muted,
                    fontSize: 8,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}
