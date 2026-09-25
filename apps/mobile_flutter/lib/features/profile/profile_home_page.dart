import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

import '../../theme/app_theme.dart';
import '../../theme/theme_mode_controller.dart';
import 'talent_profile_repository.dart';

class ProfileHomePage extends StatefulWidget {
  const ProfileHomePage({
    required this.talentProfileRepository,
    this.showNavigation = true,
    this.onLogout,
    this.themeModeController,
    super.key,
  });

  final TalentProfileRepository talentProfileRepository;
  final bool showNavigation;
  final VoidCallback? onLogout;

  /// Optional: when provided, this page shows a "Modo oscuro" toggle bound
  /// to it. Widget tests that build `ProfileHomePage` directly can omit it,
  /// in which case the toggle is not rendered (matching prior behavior).
  final ThemeModeController? themeModeController;

  @override
  State<ProfileHomePage> createState() => _ProfileHomePageState();
}

class _ProfileHomePageState extends State<ProfileHomePage> {
  late Future<_ProfileScreenData> _data;
  var _uploadingCv = false;
  var _uploadingPhoto = false;

  @override
  void initState() {
    super.initState();
    _data = _load();
  }

  Future<_ProfileScreenData> _load() async {
    final profile = await widget.talentProfileRepository.profile();
    Uint8List? photoBytes;
    if (profile.photo != null) {
      try {
        photoBytes = await widget.talentProfileRepository.profilePhoto();
      } catch (_) {
        // A missing old file must not block the rest of a worker's profile.
      }
    }
    return _ProfileScreenData(
      profile: profile,
      specialties: await widget.talentProfileRepository.specialties(),
      photoBytes: photoBytes,
    );
  }

  void _refresh() {
    setState(() {
      _data = _load();
    });
  }

  void _replaceProfile(
    _ProfileScreenData data,
    TalentProfile profile, {
    Uint8List? photoBytes,
  }) {
    setState(() {
      _data = Future.value(
        _ProfileScreenData(
          profile: profile,
          specialties: data.specialties,
          photoBytes: photoBytes ?? data.photoBytes,
        ),
      );
    });
  }

  Future<void> _uploadCv(_ProfileScreenData data) async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    if (bytes.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No pudimos leer ese archivo PDF.')),
      );
      return;
    }
    if (bytes.length > 5 * 1024 * 1024) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('El CV debe pesar como máximo 5 MB.')),
      );
      return;
    }
    setState(() => _uploadingCv = true);
    try {
      final profile = await widget.talentProfileRepository.uploadCv(
        filename: file.name,
        bytes: bytes,
      );
      if (!mounted) return;
      _replaceProfile(data, profile);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tu CV se guardó de forma privada.')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se pudo subir el CV. Inténtalo otra vez.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingCv = false);
    }
  }

  Future<void> _uploadProfilePhoto(_ProfileScreenData data) async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
    );
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    if (!mounted) return;
    if (bytes.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No pudimos leer esa imagen.')),
      );
      return;
    }
    if (bytes.length > 3 * 1024 * 1024) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('La foto debe pesar como máximo 3 MB.')),
      );
      return;
    }
    setState(() => _uploadingPhoto = true);
    try {
      final profile = await widget.talentProfileRepository.uploadProfilePhoto(
        filename: file.name,
        bytes: bytes,
      );
      if (!mounted) return;
      _replaceProfile(data, profile, photoBytes: bytes);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Foto de perfil actualizada.')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se pudo guardar la foto. Inténtalo otra vez.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingPhoto = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: FutureBuilder<_ProfileScreenData>(
        future: _data,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _ProfileFailure(onRetry: _refresh);
          }
          final data = snapshot.requireData;
          return _ProfileContent(
            data: data,
            onLogout: widget.onLogout,
            themeModeController: widget.themeModeController,
            uploadingCv: _uploadingCv,
            onUploadCv: () => _uploadCv(data),
            uploadingPhoto: _uploadingPhoto,
            onUploadPhoto: () => _uploadProfilePhoto(data),
            onEdit: () async {
              final updated = await showModalBottomSheet<TalentProfile>(
                context: context,
                isScrollControlled: true,
                builder: (_) => _EditProfileSheet(
                  profile: data.profile,
                  specialties: data.specialties,
                  repository: widget.talentProfileRepository,
                ),
              );
              if (updated != null && mounted) {
                // The PATCH response is the source of truth for this edit. Applying it
                // directly avoids leaving the screen stale while a second request is in
                // flight (or served from an intermediary cache).
                _replaceProfile(data, updated);
                ScaffoldMessenger.of(this.context).showSnackBar(
                  const SnackBar(
                    content: Text('Perfil actualizado correctamente.'),
                  ),
                );
              }
            },
          );
        },
      ),
    ),
  );
}

class _ProfileScreenData {
  const _ProfileScreenData({
    required this.profile,
    required this.specialties,
    this.photoBytes,
  });
  final TalentProfile profile;
  final List<Specialty> specialties;
  final Uint8List? photoBytes;
}

class _ProfileFailure extends StatelessWidget {
  const _ProfileFailure({required this.onRetry});
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
            'No pudimos cargar tu perfil',
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

class _ProfileContent extends StatelessWidget {
  const _ProfileContent({
    required this.data,
    required this.onEdit,
    required this.onUploadCv,
    required this.uploadingCv,
    required this.onUploadPhoto,
    required this.uploadingPhoto,
    this.onLogout,
    this.themeModeController,
  });
  final _ProfileScreenData data;
  final VoidCallback onEdit;
  final VoidCallback onUploadCv;
  final bool uploadingCv;
  final VoidCallback onUploadPhoto;
  final bool uploadingPhoto;
  final VoidCallback? onLogout;
  final ThemeModeController? themeModeController;

  @override
  Widget build(BuildContext context) => CustomScrollView(
    slivers: [
      SliverToBoxAdapter(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1120),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 22, 24, 44),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final isWide = constraints.maxWidth >= 760;
                  final profile = data.profile;
                  final specialtiesCard = _ProfileCard(
                    icon: Icons.workspace_premium_outlined,
                    title: 'Especialidades',
                    subtitle: 'Lo que sabes hacer',
                    child: profile.specialties.isEmpty
                        ? const _EmptyProfileDetail(
                            icon: Icons.add_circle_outline,
                            text:
                                'Añade especialidades para aparecer en búsquedas relevantes.',
                          )
                        : Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: profile.specialties
                                .map(
                                  (item) => Chip(
                                    avatar: const Icon(
                                      Icons.check_circle_rounded,
                                      color: AppColors.teal,
                                      size: 16,
                                    ),
                                    label: Text(_specialtyLabel(item)),
                                  ),
                                )
                                .toList(),
                          ),
                  );
                  final visibilityCard = _ProfileCard(
                    icon: profile.isVisible
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    title: 'Visibilidad',
                    subtitle: profile.isVisible
                        ? 'Perfil visible'
                        : 'Perfil oculto',
                    child: _VisibilityDetail(profile: profile),
                  );
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _TopBar(onLogout: onLogout),
                      if (themeModeController != null) ...[
                        const SizedBox(height: 14),
                        _AppearanceCard(controller: themeModeController!),
                      ],
                      const SizedBox(height: 18),
                      _ProfileHero(
                        profile: profile,
                        photoBytes: data.photoBytes,
                        onEdit: onEdit,
                        onUploadPhoto: onUploadPhoto,
                        uploadingPhoto: uploadingPhoto,
                      ),
                      const SizedBox(height: 18),
                      if (isWide)
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: specialtiesCard),
                            const SizedBox(width: 18),
                            Expanded(child: visibilityCard),
                          ],
                        )
                      else ...[
                        specialtiesCard,
                        const SizedBox(height: 14),
                        visibilityCard,
                      ],
                      const SizedBox(height: 18),
                      _ProfileCard(
                        icon: Icons.person_outline_rounded,
                        title: 'Sobre mí',
                        subtitle: 'Tu presentación profesional',
                        child: profile.bio?.isNotEmpty == true
                            ? Text(
                                profile.bio!,
                                style: Theme.of(context).textTheme.bodyLarge,
                              )
                            : const _EmptyProfileDetail(
                                icon: Icons.edit_note_rounded,
                                text:
                                    'Cuenta brevemente tu experiencia y el tipo de turnos que buscas.',
                              ),
                      ),
                      const SizedBox(height: 18),
                      _ProfileCard(
                        icon: Icons.description_outlined,
                        title: 'Tu CV',
                        subtitle: profile.cv == null
                            ? 'Aún no has cargado tu CV'
                            : profile.isVisible
                            ? 'Lo abren solo las empresas a cuyos turnos te postulas'
                            : 'Solo tú puedes abrirlo mientras tu perfil esté oculto',
                        child: _CvDetail(
                          document: profile.cv,
                          uploading: uploadingCv,
                          onUpload: onUploadCv,
                        ),
                      ),
                      const SizedBox(height: 18),
                      _ProfileCard(
                        icon: Icons.map_outlined,
                        title: 'Radio y distritos de trabajo',
                        subtitle: 'Dónde aceptas turnos',
                        child: _WorkAreaDetail(profile: profile),
                      ),
                      const SizedBox(height: 18),
                      _ProfileCard(
                        icon: Icons.work_outline_rounded,
                        title: 'Experiencia laboral',
                        subtitle: 'Tus puestos anteriores y el actual',
                        child: _ExperienceDetail(profile: profile),
                      ),
                      const SizedBox(height: 18),
                      _ProfileCard(
                        icon: Icons.card_membership_outlined,
                        title: 'Certificaciones',
                        subtitle: 'Cursos y certificados que declaraste',
                        child: _CertificationsDetail(profile: profile),
                      ),
                      const SizedBox(height: 18),
                      _ProfileCard(
                        icon: Icons.translate_rounded,
                        title: 'Idiomas',
                        subtitle: 'Idiomas que hablas',
                        child: _LanguagesDetail(profile: profile),
                      ),
                      const SizedBox(height: 18),
                      const _PrivacyNote(),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    ],
  );
}

class _TopBar extends StatelessWidget {
  const _TopBar({this.onLogout});
  final VoidCallback? onLogout;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Mi perfil',
              style: TextStyle(
                color: context.palette.ink,
                fontSize: 24,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              'Tu carta de presentación para nuevos turnos.',
              style: TextStyle(color: context.palette.muted),
            ),
          ],
        ),
      ),
      IconButton(
        tooltip: 'Cerrar sesión',
        onPressed: onLogout,
        icon: Icon(Icons.logout_rounded, color: context.palette.muted),
      ),
    ],
  );
}

/// Lets the worker switch the app's appearance between light and dark mode.
/// Only rendered when a [ThemeModeController] is supplied (i.e. inside the
/// real `WorkerShell`, not in widget tests that build `ProfileHomePage` in
/// isolation), so it never touches the app's `MaterialApp` on its own: it
/// only flips the controller's value, which `WorkerShell`'s own
/// `AnimatedBuilder` listens to and applies locally via `AnimatedTheme`
/// (`ChambeayaApp`'s `MaterialApp` keeps a constant light `theme`).
class _AppearanceCard extends StatelessWidget {
  const _AppearanceCard({required this.controller});
  final ThemeModeController controller;

  Future<void> _setDark(BuildContext context, bool value) async {
    try {
      await controller.setDark(value);
    } catch (_) {
      // Same reasoning as `_loadThemeMode` in `main.dart`: a `SharedPreferences`
      // failure must not surface as an uncaught async error. The switch
      // already reflects `controller.value` optimistically (set
      // synchronously before the write, via `ListenableBuilder` above), so
      // only the persisted preference may lag until the worker retries.
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No pudimos guardar tu preferencia de apariencia.'),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final dark = controller.resolveIsDark(
        MediaQuery.platformBrightnessOf(context),
      );
      return Card(
        clipBehavior: Clip.antiAlias,
        child: SwitchListTile.adaptive(
          value: dark,
          onChanged: (value) => _setDark(context, value),
          secondary: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            transitionBuilder: (child, animation) => RotationTransition(
              turns: Tween<double>(begin: .75, end: 1).animate(animation),
              child: FadeTransition(opacity: animation, child: child),
            ),
            child: Container(
              key: ValueKey(dark),
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: context.palette.accentSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                dark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
                color: AppColors.tealDark,
              ),
            ),
          ),
          title: const Text('Modo oscuro'),
          subtitle: Text(
            dark
                ? 'Activado para todo tu panel de trabajador.'
                : 'Actívalo si prefieres una vista con menos brillo.',
          ),
        ),
      );
    },
  );
}

class _ProfileHero extends StatelessWidget {
  const _ProfileHero({
    required this.profile,
    required this.onEdit,
    required this.onUploadPhoto,
    required this.uploadingPhoto,
    this.photoBytes,
  });
  final TalentProfile profile;
  final VoidCallback onEdit;
  final VoidCallback onUploadPhoto;
  final bool uploadingPhoto;
  final Uint8List? photoBytes;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [AppColors.navy, Color(0xFF294A78)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(24),
      boxShadow: const [
        BoxShadow(
          color: AppColors.shadow,
          blurRadius: 24,
          offset: Offset(0, 10),
        ),
      ],
    ),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 560;
        final details = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              profile.name,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 23,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              profile.headline?.isNotEmpty == true
                  ? profile.headline!
                  : 'Añade un titular que describa tu experiencia',
              style: TextStyle(
                color: profile.headline?.isNotEmpty == true
                    ? const Color(0xFFDCE7F6)
                    : const Color(0xFFB9CAE2),
                height: 1.35,
              ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                _HeroFact(
                  icon: Icons.location_on_outlined,
                  label: profile.district?.isNotEmpty == true
                      ? profile.district!
                      : 'Distrito pendiente',
                ),
                _HeroFact(
                  icon: profile.isAvailable
                      ? Icons.check_circle_outline
                      : Icons.pause_circle_outline,
                  label: profile.isAvailable
                      ? _availabilitySummary(profile)
                      : 'No disponible',
                ),
              ],
            ),
          ],
        );
        final identity = Stack(
          clipBehavior: Clip.none,
          children: [
            CircleAvatar(
              radius: 35,
              backgroundColor: const Color(0x24FFFFFF),
              backgroundImage: photoBytes == null
                  ? null
                  : MemoryImage(photoBytes!),
              child: photoBytes == null
                  ? Text(
                      _initials(profile.name),
                      style: const TextStyle(
                        fontSize: 23,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                      ),
                    )
                  : null,
            ),
            Positioned(
              right: -6,
              bottom: -6,
              child: Material(
                color: AppColors.teal,
                shape: const CircleBorder(),
                child: InkWell(
                  onTap: uploadingPhoto ? null : onUploadPhoto,
                  customBorder: const CircleBorder(),
                  child: SizedBox(
                    width: 30,
                    height: 30,
                    child: Center(
                      child: uploadingPhoto
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.navy,
                              ),
                            )
                          : const Icon(
                              Icons.camera_alt_outlined,
                              size: 17,
                              color: AppColors.navy,
                            ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (compact) ...[
              identity,
              const SizedBox(height: 16),
              details,
            ] else
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  identity,
                  const SizedBox(width: 18),
                  Expanded(child: details),
                ],
              ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(child: _ProfileProgress(value: profile.completion)),
                const SizedBox(width: 16),
                FilledButton.icon(
                  onPressed: onEdit,
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.navy,
                  ),
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Editar perfil'),
                ),
              ],
            ),
          ],
        );
      },
    ),
  );
}

class _HeroFact extends StatelessWidget {
  const _HeroFact({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(maxWidth: 260),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0x1FFFFFFF),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppColors.teal),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Color(0xFFE7F0FC), fontSize: 12),
          ),
        ),
      ],
    ),
  );
}

class _ProfileProgress extends StatelessWidget {
  const _ProfileProgress({required this.value});
  final int value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        '$value% completado',
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 7),
      ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: LinearProgressIndicator(
          value: value / 100,
          minHeight: 7,
          backgroundColor: const Color(0x38FFFFFF),
          valueColor: const AlwaysStoppedAnimation(AppColors.teal),
        ),
      ),
    ],
  );
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.child,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: context.palette.accentSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: AppColors.tealDark),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Divider(),
          ),
          child,
        ],
      ),
    ),
  );
}

class _EmptyProfileDetail extends StatelessWidget {
  const _EmptyProfileDetail({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 19, color: context.palette.muted),
      const SizedBox(width: 9),
      Expanded(
        child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
      ),
    ],
  );
}

class _VisibilityDetail extends StatelessWidget {
  const _VisibilityDetail({required this.profile});
  final TalentProfile profile;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        profile.isVisible
            ? 'Las empresas podrán encontrarte por especialidad.'
            : 'Tu perfil no aparece en las búsquedas empresariales.',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 12),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: profile.isVisible
              ? context.palette.accentSoft
              : context.palette.surfaceMuted,
          borderRadius: BorderRadius.circular(9),
        ),
        child: Text(
          profile.isVisible ? 'Visible para empresas' : 'Solo visible para ti',
          style: TextStyle(
            color: profile.isVisible
                ? AppColors.tealDark
                : context.palette.muted,
            fontWeight: FontWeight.w800,
            fontSize: 12,
          ),
        ),
      ),
    ],
  );
}

/// Indicador reutilizable de visibilidad granular por sección (experiencia,
/// certificaciones, idiomas, radio/distritos), independiente de la
/// visibilidad del perfil entero (`_VisibilityDetail`, arriba).
class _SectionVisibilityBadge extends StatelessWidget {
  const _SectionVisibilityBadge({required this.visible});
  final bool visible;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: visible
          ? context.palette.accentSoft
          : context.palette.surfaceMuted,
      borderRadius: BorderRadius.circular(9),
    ),
    child: Text(
      visible
          ? 'Visible en tu tarjeta pública'
          : 'Oculta de tu tarjeta pública',
      style: TextStyle(
        color: visible ? AppColors.tealDark : context.palette.muted,
        fontWeight: FontWeight.w800,
        fontSize: 11,
      ),
    ),
  );
}

class _WorkAreaDetail extends StatelessWidget {
  const _WorkAreaDetail({required this.profile});
  final TalentProfile profile;

  @override
  Widget build(BuildContext context) {
    final hasArea =
        profile.workRadiusKm != null || profile.workDistricts.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionVisibilityBadge(visible: profile.isWorkAreaVisible),
        const SizedBox(height: 12),
        if (!hasArea)
          const _EmptyProfileDetail(
            icon: Icons.pin_drop_outlined,
            text:
                'Aún no defines un radio ni distritos adicionales donde aceptas turnos.',
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (profile.workRadiusKm != null)
                Chip(label: Text('Radio: ${profile.workRadiusKm} km')),
              ...profile.workDistricts.map(
                (district) => Chip(label: Text(district)),
              ),
            ],
          ),
      ],
    );
  }
}

class _ExperienceDetail extends StatelessWidget {
  const _ExperienceDetail({required this.profile});
  final TalentProfile profile;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _SectionVisibilityBadge(visible: profile.isExperienceVisible),
      const SizedBox(height: 12),
      if (profile.experiences.isEmpty)
        const _EmptyProfileDetail(
          icon: Icons.work_history_outlined,
          text: 'Añade tus puestos anteriores para reforzar tu perfil.',
        )
      else
        Column(
          children: [
            for (final experience in profile.experiences) ...[
              _ExperienceReadTile(experience: experience),
              if (experience != profile.experiences.last)
                const Divider(height: 20),
            ],
          ],
        ),
    ],
  );
}

class _ExperienceReadTile extends StatelessWidget {
  const _ExperienceReadTile({required this.experience});
  final WorkExperience experience;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        '${experience.role} · ${experience.employer}',
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 3),
      Text(
        _dateRangeLabel(experience.startDate, experience.endDate),
        style: TextStyle(color: context.palette.muted, fontSize: 12),
      ),
      if (experience.description?.isNotEmpty == true) ...[
        const SizedBox(height: 6),
        Text(experience.description!),
      ],
    ],
  );
}

class _CertificationsDetail extends StatelessWidget {
  const _CertificationsDetail({required this.profile});
  final TalentProfile profile;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _SectionVisibilityBadge(visible: profile.isCertificationsVisible),
      const SizedBox(height: 12),
      if (profile.certifications.isEmpty)
        const _EmptyProfileDetail(
          icon: Icons.card_membership_outlined,
          text: 'Añade cursos o certificados que hayas completado.',
        )
      else
        Column(
          children: [
            for (final certification in profile.certifications) ...[
              _CertificationReadTile(certification: certification),
              if (certification != profile.certifications.last)
                const Divider(height: 20),
            ],
          ],
        ),
    ],
  );
}

class _CertificationReadTile extends StatelessWidget {
  const _CertificationReadTile({required this.certification});
  final Certification certification;

  @override
  Widget build(BuildContext context) {
    // Metadato declarado por el trabajador: esta interfaz nunca muestra ni
    // insinúa un estado de "verificado" para una certificación, porque el
    // servidor no lo tiene.
    final subtitleParts = <String>[
      if (certification.issuer?.isNotEmpty == true) certification.issuer!,
      if (certification.issueDate != null)
        'Obtenida ${_formatMonthYear(certification.issueDate!)}',
      if (certification.expirationDate != null)
        'Vence ${_formatMonthYear(certification.expirationDate!)}',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          certification.name,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        if (subtitleParts.isNotEmpty) ...[
          const SizedBox(height: 3),
          Text(
            subtitleParts.join(' · '),
            style: TextStyle(color: context.palette.muted, fontSize: 12),
          ),
        ],
      ],
    );
  }
}

class _LanguagesDetail extends StatelessWidget {
  const _LanguagesDetail({required this.profile});
  final TalentProfile profile;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _SectionVisibilityBadge(visible: profile.isLanguagesVisible),
      const SizedBox(height: 12),
      if (profile.languages.isEmpty)
        const _EmptyProfileDetail(
          icon: Icons.translate_outlined,
          text: 'Añade los idiomas que hablas y tu nivel en cada uno.',
        )
      else
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: profile.languages
              .map(
                (item) => Chip(
                  label: Text(
                    '${item.language} · ${_languageProficiencyLabels[item.proficiency] ?? item.proficiency}',
                  ),
                ),
              )
              .toList(),
        ),
    ],
  );
}

class _PrivacyNote extends StatelessWidget {
  const _PrivacyNote();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: context.palette.surfaceMuted,
      borderRadius: BorderRadius.circular(15),
      border: Border.all(color: context.palette.border),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          Icons.lock_outline_rounded,
          color: context.palette.muted,
          size: 19,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            'Tu CV se guarda en almacenamiento privado y nunca se muestra en el directorio empresarial. Una empresa solo puede abrirlo, en modo lectura, si te postulas a uno de sus turnos y tu perfil está visible; si lo ocultas, deja de verlo.',
            style: TextStyle(
              color: context.palette.muted,
              fontSize: 12,
              height: 1.4,
            ),
          ),
        ),
      ],
    ),
  );
}

class _CvDetail extends StatelessWidget {
  const _CvDetail({
    required this.document,
    required this.uploading,
    required this.onUpload,
  });
  final CvDocument? document;
  final bool uploading;
  final VoidCallback onUpload;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (document == null)
        const _EmptyProfileDetail(
          icon: Icons.picture_as_pdf_outlined,
          text:
              'Adjunta un PDF de hasta 5 MB para tenerlo listo cuando una empresa lo solicite.',
        )
      else
        Row(
          children: [
            const Icon(Icons.picture_as_pdf_rounded, color: AppColors.tealDark),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                '${document!.originalName} · ${_fileSize(document!.sizeBytes)}',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      const SizedBox(height: 14),
      OutlinedButton.icon(
        onPressed: uploading ? null : onUpload,
        icon: uploading
            ? const SizedBox(
                width: 17,
                height: 17,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.upload_file_outlined),
        label: Text(
          uploading
              ? 'Subiendo...'
              : document == null
              ? 'Subir CV'
              : 'Reemplazar CV',
        ),
      ),
    ],
  );
}

class _EditProfileSheet extends StatefulWidget {
  const _EditProfileSheet({
    required this.profile,
    required this.specialties,
    required this.repository,
  });
  final TalentProfile profile;
  final List<Specialty> specialties;
  final TalentProfileRepository repository;
  @override
  State<_EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends State<_EditProfileSheet> {
  late final _headline = TextEditingController(
    text: widget.profile.headline ?? '',
  );
  late final _bio = TextEditingController(text: widget.profile.bio ?? '');
  late final _district = TextEditingController(
    text: widget.profile.district ?? '',
  );
  late final _availability = TextEditingController(
    text: widget.profile.availabilityText ?? '',
  );
  late final Map<String, TalentSpecialtyDraft> _selected = {
    for (final item in widget.profile.specialties)
      item.id: TalentSpecialtyDraft(
        specialtyId: item.id,
        proficiency: item.proficiency ?? 'INTERMEDIATE',
        yearsExperience: item.yearsExperience,
      ),
  };
  late final Set<String> _days = widget.profile.availabilityDays.toSet();
  late final Set<String> _periods = widget.profile.availabilityPeriods.toSet();
  late bool _available = widget.profile.isAvailable;
  late bool _visible = widget.profile.isVisible;
  late final _workRadius = TextEditingController(
    text: widget.profile.workRadiusKm?.toString() ?? '',
  );
  late final List<String> _workDistricts = List.of(
    widget.profile.workDistricts,
  );
  final _workDistrictInput = TextEditingController();
  late bool _workAreaVisible = widget.profile.isWorkAreaVisible;
  late final List<WorkExperienceDraft> _experiences = widget.profile.experiences
      .map(
        (item) => WorkExperienceDraft(
          role: item.role,
          employer: item.employer,
          description: item.description,
          startDate: item.startDate,
          endDate: item.endDate,
        ),
      )
      .toList();
  late bool _experienceVisible = widget.profile.isExperienceVisible;
  late final List<CertificationDraft> _certifications = widget
      .profile
      .certifications
      .map(
        (item) => CertificationDraft(
          name: item.name,
          issuer: item.issuer,
          issueDate: item.issueDate,
          expirationDate: item.expirationDate,
          credentialId: item.credentialId,
        ),
      )
      .toList();
  late bool _certificationsVisible = widget.profile.isCertificationsVisible;
  late final List<LanguageDraft> _languages = widget.profile.languages
      .map(
        (item) => LanguageDraft(
          language: item.language,
          proficiency: item.proficiency,
        ),
      )
      .toList();
  late bool _languagesVisible = widget.profile.isLanguagesVisible;
  var _saving = false;
  String? _error;

  @override
  void dispose() {
    _headline.dispose();
    _bio.dispose();
    _district.dispose();
    _availability.dispose();
    _workRadius.dispose();
    _workDistrictInput.dispose();
    super.dispose();
  }

  String? _value(TextEditingController controller) =>
      controller.text.trim().isEmpty ? null : controller.text.trim();

  void _addWorkDistrict() {
    final value = _workDistrictInput.text.trim();
    if (value.isEmpty || _workDistricts.length >= 10) return;
    if (_workDistricts.any(
      (existing) => existing.toLowerCase() == value.toLowerCase(),
    )) {
      _workDistrictInput.clear();
      return;
    }
    setState(() {
      _workDistricts.add(value);
      _workDistrictInput.clear();
    });
  }

  Future<void> _save() async {
    setState(() => _error = null);
    final radiusText = _workRadius.text.trim();
    int? radius;
    if (radiusText.isNotEmpty) {
      radius = int.tryParse(radiusText);
      if (radius == null || radius < 1 || radius > 200) {
        setState(
          () => _error =
              'El radio de trabajo debe ser un número entre 1 y 200 km.',
        );
        return;
      }
    }
    setState(() => _saving = true);
    try {
      final profile = await widget.repository.update(
        TalentProfileDraft(
          headline: _value(_headline),
          bio: _value(_bio),
          district: _value(_district),
          availabilityText: _value(_availability),
          availabilityDays: _days.toList(),
          availabilityPeriods: _periods.toList(),
          isAvailable: _available,
          isVisible: _visible,
          specialties: _selected.values.toList(),
          workRadiusKm: radius,
          workDistricts: _workDistricts,
          isExperienceVisible: _experienceVisible,
          isCertificationsVisible: _certificationsVisible,
          isLanguagesVisible: _languagesVisible,
          isWorkAreaVisible: _workAreaVisible,
          experiences: _experiences,
          certifications: _certifications,
          languages: _languages,
        ),
      );
      if (mounted) Navigator.pop(context, profile);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'No se pudo guardar. Revisa los campos e inténtalo otra vez.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _addOrEditExperience({int? index}) async {
    final draft = await showDialog<WorkExperienceDraft>(
      context: context,
      builder: (_) => _ExperienceEditorDialog(
        initial: index == null ? null : _experiences[index],
      ),
    );
    if (draft == null || !mounted) return;
    setState(() {
      if (index == null) {
        _experiences.add(draft);
      } else {
        _experiences[index] = draft;
      }
    });
  }

  Future<void> _addOrEditCertification({int? index}) async {
    final draft = await showDialog<CertificationDraft>(
      context: context,
      builder: (_) => _CertificationEditorDialog(
        initial: index == null ? null : _certifications[index],
      ),
    );
    if (draft == null || !mounted) return;
    setState(() {
      if (index == null) {
        _certifications.add(draft);
      } else {
        _certifications[index] = draft;
      }
    });
  }

  Future<void> _addOrEditLanguage({int? index}) async {
    final existingLanguages = [
      for (var i = 0; i < _languages.length; i++)
        if (i != index) _languages[i].language.trim().toLowerCase(),
    ];
    final draft = await showDialog<LanguageDraft>(
      context: context,
      builder: (_) => _LanguageEditorDialog(
        initial: index == null ? null : _languages[index],
        existingLanguages: existingLanguages,
      ),
    );
    if (draft == null || !mounted) return;
    setState(() {
      if (index == null) {
        _languages.add(draft);
      } else {
        _languages[index] = draft;
      }
    });
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        18,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Personaliza tu perfil',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              'Solo comparte información que ayude a encontrar turnos adecuados.',
              style: TextStyle(color: context.palette.muted),
            ),
            const SizedBox(height: 18),
            TextField(
              controller: _headline,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: 'Titular profesional',
                hintText: 'Ej. Barista y atención al cliente',
              ),
            ),
            TextField(
              controller: _district,
              maxLength: 80,
              decoration: const InputDecoration(labelText: 'Distrito'),
            ),
            TextField(
              controller: _availability,
              maxLength: 160,
              decoration: const InputDecoration(
                labelText: 'Notas de disponibilidad',
                hintText: 'Ej. No puedo trabajar los martes',
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Días que puedes trabajar',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _daysOfWeek.entries
                  .map(
                    (entry) => FilterChip(
                      label: Text(entry.value),
                      selected: _days.contains(entry.key),
                      onSelected: (selected) => setState(() {
                        if (selected) {
                          _days.add(entry.key);
                        } else {
                          _days.remove(entry.key);
                        }
                      }),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 16),
            Text(
              'Horarios preferidos',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _availabilityPeriods.entries
                  .map(
                    (entry) => FilterChip(
                      label: Text(entry.value),
                      selected: _periods.contains(entry.key),
                      onSelected: (selected) => setState(() {
                        if (selected) {
                          _periods.add(entry.key);
                        } else {
                          _periods.remove(entry.key);
                        }
                      }),
                    ),
                  )
                  .toList(),
            ),
            TextField(
              controller: _bio,
              maxLength: 800,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'Sobre mí'),
            ),
            const SizedBox(height: 8),
            Text(
              'Especialidades',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 6),
            if (widget.specialties.isEmpty)
              Text(
                'No hay especialidades disponibles para esta cuenta todavía.',
                style: TextStyle(color: context.palette.muted),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: widget.specialties
                    .map(
                      (specialty) => FilterChip(
                        label: Text(specialty.name),
                        selected: _selected.containsKey(specialty.id),
                        onSelected: (selected) => setState(() {
                          if (selected) {
                            _selected[specialty.id] = TalentSpecialtyDraft(
                              specialtyId: specialty.id,
                              proficiency: 'INTERMEDIATE',
                            );
                          } else {
                            _selected.remove(specialty.id);
                          }
                        }),
                      ),
                    )
                    .toList(),
              ),
            if (_selected.isNotEmpty) ...[
              const SizedBox(height: 14),
              const Text(
                'Nivel y experiencia',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              ...widget.specialties
                  .where((item) => _selected.containsKey(item.id))
                  .map(
                    (specialty) => _SpecialtyDetailEditor(
                      specialty: specialty,
                      value: _selected[specialty.id]!,
                      onChanged: (value) =>
                          setState(() => _selected[specialty.id] = value),
                    ),
                  ),
            ],
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Disponible para nuevos turnos'),
              value: _available,
              onChanged: (value) => setState(() => _available = value),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mostrarme en búsquedas empresariales'),
              subtitle: const Text(
                'Las empresas verán solo datos profesionales en el directorio de talento.',
              ),
              value: _visible,
              onChanged: (value) => setState(() => _visible = value),
            ),
            const Divider(height: 28),
            Text(
              'Radio y distritos de trabajo',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _workRadius,
              keyboardType: TextInputType.number,
              maxLength: 3,
              decoration: const InputDecoration(
                labelText: 'Radio de trabajo (km)',
                hintText: 'Ej. 10',
                counterText: '',
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final district in _workDistricts)
                  Chip(
                    label: Text(district),
                    onDeleted: () =>
                        setState(() => _workDistricts.remove(district)),
                  ),
              ],
            ),
            if (_workDistricts.length < 10) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _workDistrictInput,
                      maxLength: 80,
                      decoration: const InputDecoration(
                        labelText: 'Agregar distrito',
                        counterText: '',
                      ),
                      onSubmitted: (_) => _addWorkDistrict(),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Agregar distrito',
                    onPressed: _addWorkDistrict,
                    icon: const Icon(Icons.add_circle_outline),
                  ),
                ],
              ),
            ],
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mostrar mi radio y distritos a las empresas'),
              value: _workAreaVisible,
              onChanged: (value) => setState(() => _workAreaVisible = value),
            ),
            const Divider(height: 28),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Experiencia laboral',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _addOrEditExperience(),
                  icon: const Icon(Icons.add),
                  label: const Text('Agregar'),
                ),
              ],
            ),
            if (_experiences.isEmpty)
              Text(
                'Aún no agregaste experiencia laboral.',
                style: TextStyle(color: context.palette.muted),
              )
            else
              for (var index = 0; index < _experiences.length; index++)
                _DraftListTile(
                  title:
                      '${_experiences[index].role} · ${_experiences[index].employer}',
                  subtitle: _dateRangeLabel(
                    _experiences[index].startDate,
                    _experiences[index].endDate,
                  ),
                  onEdit: () => _addOrEditExperience(index: index),
                  onDelete: () => setState(() => _experiences.removeAt(index)),
                ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mostrar mi experiencia a las empresas'),
              value: _experienceVisible,
              onChanged: (value) => setState(() => _experienceVisible = value),
            ),
            const Divider(height: 28),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Certificaciones',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _addOrEditCertification(),
                  icon: const Icon(Icons.add),
                  label: const Text('Agregar'),
                ),
              ],
            ),
            Text(
              'Certificados que declaras tú mismo; Chambeaya no los verifica.',
              style: TextStyle(color: context.palette.muted, fontSize: 12),
            ),
            const SizedBox(height: 6),
            if (_certifications.isEmpty)
              Text(
                'Aún no agregaste certificaciones.',
                style: TextStyle(color: context.palette.muted),
              )
            else
              for (var index = 0; index < _certifications.length; index++)
                _DraftListTile(
                  title: _certifications[index].name,
                  subtitle: [
                    if (_certifications[index].issuer?.isNotEmpty == true)
                      _certifications[index].issuer!,
                    if (_certifications[index].issueDate != null)
                      'Obtenida ${_formatMonthYear(_certifications[index].issueDate!)}',
                  ].join(' · '),
                  onEdit: () => _addOrEditCertification(index: index),
                  onDelete: () =>
                      setState(() => _certifications.removeAt(index)),
                ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mostrar mis certificaciones a las empresas'),
              value: _certificationsVisible,
              onChanged: (value) =>
                  setState(() => _certificationsVisible = value),
            ),
            const Divider(height: 28),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Idiomas',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _addOrEditLanguage(),
                  icon: const Icon(Icons.add),
                  label: const Text('Agregar'),
                ),
              ],
            ),
            if (_languages.isEmpty)
              Text(
                'Aún no agregaste idiomas.',
                style: TextStyle(color: context.palette.muted),
              )
            else
              for (var index = 0; index < _languages.length; index++)
                _DraftListTile(
                  title: _languages[index].language,
                  subtitle:
                      _languageProficiencyLabels[_languages[index]
                          .proficiency] ??
                      _languages[index].proficiency,
                  onEdit: () => _addOrEditLanguage(index: index),
                  onDelete: () => setState(() => _languages.removeAt(index)),
                ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mostrar mis idiomas a las empresas'),
              value: _languagesVisible,
              onChanged: (value) => setState(() => _languagesVisible = value),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _saving ? null : _save,
                child: Text(_saving ? 'Guardando...' : 'Guardar cambios'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _SpecialtyDetailEditor extends StatelessWidget {
  const _SpecialtyDetailEditor({
    required this.specialty,
    required this.value,
    required this.onChanged,
  });
  final Specialty specialty;
  final TalentSpecialtyDraft value;
  final ValueChanged<TalentSpecialtyDraft> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.palette.surfaceMuted,
        border: Border.all(color: context.palette.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            specialty.name,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: value.proficiency,
                  decoration: const InputDecoration(
                    labelText: 'Nivel',
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                  ),
                  items: _proficiencyLabels.entries
                      .map(
                        (entry) => DropdownMenuItem(
                          value: entry.key,
                          child: Text(entry.value),
                        ),
                      )
                      .toList(),
                  onChanged: (proficiency) {
                    if (proficiency == null) return;
                    onChanged(
                      TalentSpecialtyDraft(
                        specialtyId: value.specialtyId,
                        proficiency: proficiency,
                        yearsExperience: value.yearsExperience,
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextFormField(
                  key: ValueKey('experience-${specialty.id}'),
                  initialValue: value.yearsExperience?.toString() ?? '',
                  keyboardType: TextInputType.number,
                  maxLength: 2,
                  decoration: const InputDecoration(
                    labelText: 'Años',
                    counterText: '',
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                  ),
                  onChanged: (years) {
                    final parsed = int.tryParse(years);
                    onChanged(
                      TalentSpecialtyDraft(
                        specialtyId: value.specialtyId,
                        proficiency: value.proficiency,
                        yearsExperience:
                            parsed != null && parsed >= 0 && parsed <= 60
                            ? parsed
                            : null,
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}

/// Fila compacta de una entrada ya agregada a una de las cuatro listas
/// nuevas (experiencia, certificaciones, idiomas), con acciones de editar y
/// eliminar. Los cambios solo se envían al servidor cuando se pulsa
/// "Guardar cambios" en el formulario que la contiene.
class _DraftListTile extends StatelessWidget {
  const _DraftListTile({
    required this.title,
    required this.subtitle,
    required this.onEdit,
    required this.onDelete,
  });
  final String title;
  final String subtitle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: context.palette.surfaceMuted,
      border: Border.all(color: context.palette.border),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
              if (subtitle.isNotEmpty)
                Text(
                  subtitle,
                  style: TextStyle(color: context.palette.muted, fontSize: 12),
                ),
            ],
          ),
        ),
        IconButton(
          tooltip: 'Editar',
          onPressed: onEdit,
          icon: const Icon(Icons.edit_outlined, size: 20),
        ),
        IconButton(
          tooltip: 'Eliminar',
          onPressed: onDelete,
          icon: const Icon(Icons.delete_outline, size: 20),
        ),
      ],
    ),
  );
}

class _ExperienceEditorDialog extends StatefulWidget {
  const _ExperienceEditorDialog({this.initial});
  final WorkExperienceDraft? initial;

  @override
  State<_ExperienceEditorDialog> createState() =>
      _ExperienceEditorDialogState();
}

class _ExperienceEditorDialogState extends State<_ExperienceEditorDialog> {
  late final _role = TextEditingController(text: widget.initial?.role ?? '');
  late final _employer = TextEditingController(
    text: widget.initial?.employer ?? '',
  );
  late final _description = TextEditingController(
    text: widget.initial?.description ?? '',
  );
  DateTime? _startDate;
  DateTime? _endDate;
  late bool _current = widget.initial?.endDate == null;
  String? _error;

  @override
  void initState() {
    super.initState();
    _startDate = widget.initial?.startDate;
    _endDate = widget.initial?.endDate;
  }

  @override
  void dispose() {
    _role.dispose();
    _employer.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isStart ? _startDate : _endDate) ?? now,
      firstDate: DateTime(1970),
      lastDate: now,
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startDate = picked;
      } else {
        _endDate = picked;
      }
    });
  }

  void _save() {
    final role = _role.text.trim();
    final employer = _employer.text.trim();
    if (role.isEmpty || employer.isEmpty) {
      setState(() => _error = 'El puesto y el empleador son obligatorios.');
      return;
    }
    if (_startDate == null) {
      setState(() => _error = 'Elige una fecha de inicio.');
      return;
    }
    if (!_current && _endDate == null) {
      setState(
        () => _error =
            'Elige una fecha de fin o marca "Trabajo aquí actualmente".',
      );
      return;
    }
    final endDate = _current ? null : _endDate;
    if (endDate != null && _startDate!.isAfter(endDate)) {
      setState(
        () => _error = 'La fecha de inicio no puede ser posterior a la de fin.',
      );
      return;
    }
    Navigator.pop(
      context,
      WorkExperienceDraft(
        role: role,
        employer: employer,
        description: _description.text.trim().isEmpty
            ? null
            : _description.text.trim(),
        startDate: _startDate!,
        endDate: endDate,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Experiencia laboral'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _role,
            maxLength: 120,
            decoration: const InputDecoration(labelText: 'Puesto'),
          ),
          TextField(
            controller: _employer,
            maxLength: 120,
            decoration: const InputDecoration(labelText: 'Empleador'),
          ),
          TextField(
            controller: _description,
            maxLength: 800,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Descripción (opcional)',
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: () => _pickDate(isStart: true),
            child: Text(
              _startDate == null
                  ? 'Elegir fecha de inicio'
                  : 'Inicio: ${_formatMonthYear(_startDate!)}',
            ),
          ),
          const SizedBox(height: 8),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Trabajo aquí actualmente'),
            value: _current,
            onChanged: (value) => setState(() => _current = value ?? false),
          ),
          if (!_current)
            OutlinedButton(
              onPressed: () => _pickDate(isStart: false),
              child: Text(
                _endDate == null
                    ? 'Elegir fecha de fin'
                    : 'Fin: ${_formatMonthYear(_endDate!)}',
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(onPressed: _save, child: const Text('Guardar')),
    ],
  );
}

class _CertificationEditorDialog extends StatefulWidget {
  const _CertificationEditorDialog({this.initial});
  final CertificationDraft? initial;

  @override
  State<_CertificationEditorDialog> createState() =>
      _CertificationEditorDialogState();
}

class _CertificationEditorDialogState
    extends State<_CertificationEditorDialog> {
  late final _name = TextEditingController(text: widget.initial?.name ?? '');
  late final _issuer = TextEditingController(
    text: widget.initial?.issuer ?? '',
  );
  late final _credentialId = TextEditingController(
    text: widget.initial?.credentialId ?? '',
  );
  DateTime? _issueDate;
  DateTime? _expirationDate;
  String? _error;

  @override
  void initState() {
    super.initState();
    _issueDate = widget.initial?.issueDate;
    _expirationDate = widget.initial?.expirationDate;
  }

  @override
  void dispose() {
    _name.dispose();
    _issuer.dispose();
    _credentialId.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isIssue}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isIssue ? _issueDate : _expirationDate) ?? now,
      firstDate: DateTime(1970),
      lastDate: DateTime(now.year + 25),
    );
    if (picked == null) return;
    setState(() {
      if (isIssue) {
        _issueDate = picked;
      } else {
        _expirationDate = picked;
      }
    });
  }

  void _save() {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'El nombre de la certificación es obligatorio.');
      return;
    }
    Navigator.pop(
      context,
      CertificationDraft(
        name: name,
        issuer: _issuer.text.trim().isEmpty ? null : _issuer.text.trim(),
        issueDate: _issueDate,
        expirationDate: _expirationDate,
        credentialId: _credentialId.text.trim().isEmpty
            ? null
            : _credentialId.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Certificación'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Metadato declarado por el trabajador: a propósito no hay ningún
          // campo de "verificado" en este formulario, porque el servidor no
          // lo admite (ver `certificationSchema`, `.strict()`).
          TextField(
            controller: _name,
            maxLength: 120,
            decoration: const InputDecoration(labelText: 'Nombre'),
          ),
          TextField(
            controller: _issuer,
            maxLength: 120,
            decoration: const InputDecoration(labelText: 'Emisor (opcional)'),
          ),
          TextField(
            controller: _credentialId,
            maxLength: 80,
            decoration: const InputDecoration(
              labelText: 'N.º de credencial (opcional)',
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: () => _pickDate(isIssue: true),
            child: Text(
              _issueDate == null
                  ? 'Elegir fecha de obtención (opcional)'
                  : 'Obtenida: ${_formatMonthYear(_issueDate!)}',
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: () => _pickDate(isIssue: false),
            child: Text(
              _expirationDate == null
                  ? 'Elegir fecha de vencimiento (opcional)'
                  : 'Vence: ${_formatMonthYear(_expirationDate!)}',
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(onPressed: _save, child: const Text('Guardar')),
    ],
  );
}

class _LanguageEditorDialog extends StatefulWidget {
  const _LanguageEditorDialog({this.initial, required this.existingLanguages});
  final LanguageDraft? initial;
  final List<String> existingLanguages;

  @override
  State<_LanguageEditorDialog> createState() => _LanguageEditorDialogState();
}

class _LanguageEditorDialogState extends State<_LanguageEditorDialog> {
  late final _language = TextEditingController(
    text: widget.initial?.language ?? '',
  );
  late String _proficiency = widget.initial?.proficiency ?? 'CONVERSATIONAL';
  String? _error;

  @override
  void dispose() {
    _language.dispose();
    super.dispose();
  }

  void _save() {
    final language = _language.text.trim();
    if (language.isEmpty) {
      setState(() => _error = 'El idioma es obligatorio.');
      return;
    }
    if (widget.existingLanguages.contains(language.toLowerCase())) {
      setState(() => _error = 'Ya agregaste este idioma.');
      return;
    }
    Navigator.pop(
      context,
      LanguageDraft(language: language, proficiency: _proficiency),
    );
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Idioma'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _language,
          maxLength: 40,
          decoration: const InputDecoration(labelText: 'Idioma'),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: _proficiency,
          decoration: const InputDecoration(labelText: 'Nivel'),
          items: _languageProficiencyLabels.entries
              .map(
                (entry) => DropdownMenuItem(
                  value: entry.key,
                  child: Text(entry.value),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) setState(() => _proficiency = value);
          },
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(_error!, style: const TextStyle(color: Colors.red)),
          ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(onPressed: _save, child: const Text('Guardar')),
    ],
  );
}

const _daysOfWeek = {
  'MONDAY': 'Lun',
  'TUESDAY': 'Mar',
  'WEDNESDAY': 'Mié',
  'THURSDAY': 'Jue',
  'FRIDAY': 'Vie',
  'SATURDAY': 'Sáb',
  'SUNDAY': 'Dom',
};

const _availabilityPeriods = {
  'MORNING': 'Mañanas',
  'AFTERNOON': 'Tardes',
  'EVENING': 'Noches',
  'OVERNIGHT': 'Madrugada',
};

const _proficiencyLabels = {
  'BEGINNER': 'Inicial',
  'INTERMEDIATE': 'Intermedio',
  'ADVANCED': 'Avanzado',
};

const _languageProficiencyLabels = {
  'BASIC': 'Básico',
  'CONVERSATIONAL': 'Conversacional',
  'FLUENT': 'Fluido',
  'NATIVE': 'Nativo',
};

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

String _formatMonthYear(DateTime date) =>
    '${_monthAbbreviations[date.month - 1]} ${date.year}';

String _dateRangeLabel(DateTime startDate, DateTime? endDate) => endDate == null
    ? 'Desde ${_formatMonthYear(startDate)} · Actualidad'
    : '${_formatMonthYear(startDate)} – ${_formatMonthYear(endDate)}';

String _specialtyLabel(Specialty specialty) {
  final level = specialty.proficiency == null
      ? null
      : _proficiencyLabels[specialty.proficiency];
  final years = specialty.yearsExperience;
  if (level == null) return specialty.name;
  final experience = years == null
      ? ''
      : ' · $years ${years == 1 ? 'año' : 'años'}';
  return '${specialty.name} · $level$experience';
}

String _availabilitySummary(TalentProfile profile) {
  if (profile.availabilityDays.isNotEmpty ||
      profile.availabilityPeriods.isNotEmpty) {
    final days = profile.availabilityDays
        .map((day) => _daysOfWeek[day] ?? day)
        .join(', ');
    final periods = profile.availabilityPeriods
        .map((period) => _availabilityPeriods[period] ?? period)
        .join(', ');
    return [days, periods].where((item) => item.isNotEmpty).join(' · ');
  }
  return profile.availabilityText ?? 'Disponible';
}

String _fileSize(int bytes) {
  if (bytes < 1024 * 1024) return '${(bytes / 1024).ceil()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

String _initials(String value) => value
    .trim()
    .split(RegExp(r'\s+'))
    .where((part) => part.isNotEmpty)
    .take(2)
    .map((part) => part[0])
    .join()
    .toUpperCase();
