import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'profile_data.dart';

class ProfileHomePage extends StatelessWidget {
  const ProfileHomePage({this.showNavigation = true, this.onLogout, super.key});
  final bool showNavigation;
  final VoidCallback? onLogout;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _TopBar(onLogout: onLogout)),
            SliverToBoxAdapter(child: _ProfileHeader()),
            SliverToBoxAdapter(child: _Strengths()),
            SliverToBoxAdapter(
              child: _SectionHeader(
                title: 'Estudios y Certificados',
                action: 'Ver todos',
              ),
            ),
            SliverToBoxAdapter(child: _Certificates()),
            SliverToBoxAdapter(
              child: _SectionHeader(
                title: 'Historial de Experiencia',
                action: 'Ver historial',
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
          onPressed: () {},
          icon: const Icon(Icons.ios_share_rounded, color: AppColors.navy),
        ),
      ],
    ),
  );
}

class _ProfileHeader extends StatelessWidget {
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
                workerProfile.name,
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
  const _SectionHeader({required this.title, required this.action});
  final String title;
  final String action;

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
