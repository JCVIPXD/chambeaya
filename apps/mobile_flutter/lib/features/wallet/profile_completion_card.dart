import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../jobs/jobs_format.dart';
import '../jobs/jobs_widgets.dart';
import 'async_section.dart';
import 'wallet_models.dart';
import 'wallet_repository.dart';

/// Indicador de completitud del perfil con las 8 secciones del criterio de
/// `PROFILE_COMPLETE` (la API es la fuente: `requiredSections` y
/// `missingSections`) y el premio asociado.
class ProfileCompletionCard extends StatelessWidget {
  const ProfileCompletionCard({
    super.key,
    required this.wallet,
    this.currencyName = 'monedas',
  });

  final WalletRepository wallet;
  final String currencyName;

  @override
  Widget build(BuildContext context) => AsyncSection<Rewards>(
    load: wallet.rewards,
    errorTitle: 'No pudimos cargar el avance de tu perfil',
    loadingLabel: 'Cargando avance del perfil',
    builder: (context, rewards) {
      final item = rewards.item(ActionKeys.profileComplete);
      if (item == null) return const SizedBox.shrink();
      return ProfileCompletionView(
        item: item,
        currencyName: rewards.currency.isEmpty ? currencyName : rewards.currency,
        documents: rewards.item(ActionKeys.documentVerified),
      );
    },
  );
}

/// Parte visual pura (sin red) del indicador, para reutilizarla y probarla.
class ProfileCompletionView extends StatelessWidget {
  const ProfileCompletionView({
    super.key,
    required this.item,
    required this.currencyName,
    this.documents,
  });

  final RewardItem item;
  final String currencyName;

  /// Premio `DOCUMENT_VERIFIED` (informativo: verifica el administrador).
  final RewardItem? documents;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final required = item.requiredSections;
    final missing = item.missingSections.toSet();
    final done = required.length - missing.length;
    final complete = required.isNotEmpty && missing.isEmpty;
    final reward = formatCoins(item.amount, currencyName);
    return SectionCard(
      title: 'Completitud de tu perfil',
      icon: Icons.task_alt_rounded,
      subtitle: item.earned
          ? 'Ya ganaste $reward por completar tu perfil.'
          : complete
          ? 'Tu perfil está completo. El premio de $reward se acredita al guardar tu perfil.'
          : 'Completa las ${required.length} secciones y gana $reward (una sola vez).',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            label: '$done de ${required.length} secciones completas',
            excludeSemantics: true,
            child: Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      minHeight: 10,
                      value: required.isEmpty ? 0 : done / required.length,
                      backgroundColor: palette.border,
                      color: AppColors.teal,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  '$done/${required.length}',
                  style: TextStyle(color: palette.ink, fontWeight: FontWeight.w900),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          for (final section in required)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Semantics(
                label: '${profileSectionLabel(section)}: ${missing.contains(section) ? 'falta' : 'completa'}',
                excludeSemantics: true,
                child: Row(
                  children: [
                    Icon(
                      missing.contains(section)
                          ? Icons.radio_button_unchecked_rounded
                          : Icons.check_circle_rounded,
                      size: 20,
                      color: missing.contains(section) ? palette.muted : AppColors.teal,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        profileSectionLabel(section),
                        style: TextStyle(color: palette.ink),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (documents != null && documents!.documents.isNotEmpty) ...[
            const Divider(height: 24),
            Text(
              'Verificación de documentos',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Un administrador revisa tu CV y tu foto. Cada documento verificado '
              'te da ${formatCoins(documents!.amount, currencyName)} (una vez por tipo). '
              'Es solo informativo: no tienes que hacer nada.',
              style: TextStyle(color: palette.muted, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 8),
            for (final document in documents!.documents)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Text(
                  '${documentKindLabel(document.kind)}: ${document.verified ? 'verificado' : document.uploaded ? 'subido, pendiente de verificación' : 'aún no lo subes'}',
                  style: TextStyle(color: palette.ink),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
