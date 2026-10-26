import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/app_theme.dart';
import '../jobs/jobs_errors.dart';
import '../jobs/jobs_format.dart';
import '../jobs/jobs_services.dart';
import '../jobs/jobs_widgets.dart';
import '../profile/talent_profile_repository.dart';
import 'async_section.dart';
import 'cost_flow.dart';
import 'profile_completion_card.dart';
import 'wallet_models.dart';

// ---------------------------------------------------------------------------
// Resumen: costos, cuota gratuita, tope diario y destacar el perfil
// ---------------------------------------------------------------------------

class SummaryTab extends StatelessWidget {
  const SummaryTab({super.key, required this.services, this.profileRepository});

  final JobsServices services;
  final TalentProfileRepository? profileRepository;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
    children: [
      AsyncSection<({Catalog catalog, Quote? quote})>(
        load: () async {
          final catalog = await services.wallet.catalog();
          Quote? quote;
          try {
            // Solo para leer el tope diario de gasto; si falla, no se muestra.
            quote = await services.wallet.quote(ActionKeys.applicationExtra);
          } catch (_) {
            quote = null;
          }
          return (catalog: catalog, quote: quote);
        },
        errorTitle: 'No pudimos cargar los costos',
        loadingLabel: 'Cargando costos',
        builder: (context, data) {
          final currency = data.catalog.currency.isEmpty
              ? services.walletController.currencyName
              : data.catalog.currency;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _CostsCard(catalog: data.catalog, currency: currency),
              if (data.quote?.dailyCap != null) ...[
                const SizedBox(height: 14),
                _DailyCapCard(cap: data.quote!.dailyCap!, currency: currency),
              ],
            ],
          );
        },
      ),
      const SizedBox(height: 14),
      HighlightProfileCard(services: services, profileRepository: profileRepository),
    ],
  );
}

class _CostsCard extends StatelessWidget {
  const _CostsCard({required this.catalog, required this.currency});

  final Catalog catalog;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return SectionCard(
      title: 'Cuánto cuesta cada acción',
      subtitle:
          'Lo básico es siempre gratis: ver puestos, aceptar o rechazar una oferta, '
          'retirarte y responder invitaciones.',
      icon: Icons.sell_outlined,
      child: catalog.costs.isEmpty
          ? Text('Por ahora ninguna acción tiene costo.', style: TextStyle(color: palette.muted))
          : Column(
              children: [
                for (final item in catalog.costs)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                actionLabel(item.actionKey),
                                style: TextStyle(color: palette.ink, fontWeight: FontWeight.w800),
                              ),
                              if (actionHint(item.actionKey).isNotEmpty)
                                Text(
                                  actionHint(item.actionKey),
                                  style: TextStyle(color: palette.muted, fontSize: 12.5),
                                ),
                              if (item.freeMonthlyQuota > 0)
                                Text(
                                  'Cuota gratuita: te quedan ${item.freeRemaining} de ${item.freeMonthlyQuota} este mes.',
                                  style: TextStyle(color: palette.ink, fontSize: 12.5),
                                ),
                              if (item.refundWindowHours != null)
                                Text(
                                  'Si la empresa no responde en ${item.refundWindowHours} h, se devuelve.',
                                  style: TextStyle(color: palette.muted, fontSize: 12.5),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(
                          formatCoins(item.amount, currency),
                          style: TextStyle(color: palette.ink, fontWeight: FontWeight.w900),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

class _DailyCapCard extends StatelessWidget {
  const _DailyCapCard({required this.cap, required this.currency});

  final DailyCap cap;
  final String currency;

  @override
  Widget build(BuildContext context) => SectionCard(
    title: 'Tope diario de gasto',
    icon: Icons.speed_rounded,
    subtitle: 'Protege tu saldo: el día cambia a medianoche, hora de Lima.',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Hoy gastaste ${formatCoins(cap.spentToday, currency)} de ${formatCoins(cap.limit, currency)}.',
          style: TextStyle(color: context.palette.ink, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            minHeight: 8,
            value: cap.limit <= 0 ? 0 : (cap.spentToday / cap.limit).clamp(0, 1).toDouble(),
            backgroundColor: context.palette.border,
            color: AppColors.teal,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Puedes gastar ${formatCoins(cap.remaining, currency)} más hoy.',
          style: TextStyle(color: context.palette.muted, fontSize: 13),
        ),
      ],
    ),
  );
}

/// Destacar el perfil: costo previo, vigencia y confirmación.
class HighlightProfileCard extends StatefulWidget {
  const HighlightProfileCard({
    super.key,
    required this.services,
    this.profileRepository,
  });

  final JobsServices services;
  final TalentProfileRepository? profileRepository;

  @override
  State<HighlightProfileCard> createState() => _HighlightProfileCardState();
}

class _HighlightProfileCardState extends State<HighlightProfileCard> {
  TalentProfile? _profile;
  DateTime? _highlightedUntil;
  bool _loadingProfile = true;
  bool _busy = false;
  JobsErrorInfo? _error;
  String? _success;

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final repository = widget.profileRepository;
    if (repository == null) {
      setState(() => _loadingProfile = false);
      return;
    }
    try {
      final profile = await repository.profile();
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _highlightedUntil = profile.highlightedUntil;
        _loadingProfile = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingProfile = false);
    }
  }

  bool get _active =>
      _highlightedUntil != null && _highlightedUntil!.isAfter(DateTime.now());

  Future<void> _highlight() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _success = null;
    });
    final services = widget.services;
    try {
      final result = await confirmCosts(
        context,
        wallet: services.wallet,
        currencyName: services.walletController.currencyName,
        title: 'Destacar tu perfil',
        requests: [
          CostRequest(
            actionKey: ActionKeys.profileHighlight,
            label: 'Destacar el perfil',
            targetId: _profile?.id,
          ),
        ],
        onCurrency: services.walletController.adoptCurrencyName,
      );
      if (!mounted) return;
      if (!result.proceed) {
        setState(() => _busy = false);
        return;
      }
      final outcome = await services.wallet.highlightProfile();
      services.walletController.refresh();
      if (!mounted) return;
      final currency = services.walletController.currencyName;
      setState(() {
        _busy = false;
        _highlightedUntil = outcome.highlightedUntil;
        _success = outcome.idempotent
            ? 'Tu perfil ya estaba destacado. No se cobró de nuevo.'
            : outcome.chargedAmount > 0
            ? 'Tu perfil quedó destacado. Se descontaron ${formatCoins(outcome.chargedAmount, currency)}.'
            : 'Tu perfil quedó destacado. No tuvo costo.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = describeJobsError(
          error,
          currency: services.walletController.currencyName,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final hidden = _profile != null && !_profile!.isVisible;
    return SectionCard(
      title: 'Destacar mi perfil',
      icon: Icons.star_outline_rounded,
      subtitle:
          'Tu perfil aparece primero en la búsqueda de talento de las empresas durante unos días.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_loadingProfile)
            const LinearProgressIndicator()
          else if (_active)
            Semantics(
              liveRegion: true,
              child: Text(
                'Tu perfil está destacado hasta el ${formatDateTime(_highlightedUntil!)}.',
                style: TextStyle(color: palette.ink, fontWeight: FontWeight.w800),
              ),
            )
          else if (hidden)
            Text(
              'Tu perfil está oculto. Hazlo visible desde "Editar perfil" para poder destacarlo.',
              style: TextStyle(color: palette.muted),
            ),
          if (_success != null) ...[
            const SizedBox(height: 8),
            Semantics(
              liveRegion: true,
              child: Text(_success!, style: TextStyle(color: palette.ink)),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            ErrorNotice(info: _error!, onRetry: _highlight),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('highlight-profile'),
            onPressed: _busy || _loadingProfile || _active || hidden ? null : _highlight,
            icon: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.star_rounded),
            label: Text(_active ? 'Perfil destacado' : 'Destacar mi perfil'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Ganar: completitud, premios y referidos
// ---------------------------------------------------------------------------

class RewardsTab extends StatelessWidget {
  const RewardsTab({super.key, required this.services});

  final JobsServices services;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
    children: [
      AsyncSection<Rewards>(
        load: services.wallet.rewards,
        errorTitle: 'No pudimos cargar tus premios',
        loadingLabel: 'Cargando premios',
        builder: (context, rewards) {
          final currency = rewards.currency.isEmpty
              ? services.walletController.currencyName
              : rewards.currency;
          final complete = rewards.item(ActionKeys.profileComplete);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (complete != null) ...[
                ProfileCompletionView(
                  item: complete,
                  currencyName: currency,
                  documents: rewards.item(ActionKeys.documentVerified),
                ),
                const SizedBox(height: 14),
              ],
              SectionCard(
                title: 'Premios para ti',
                subtitle: 'Se acreditan solos cuando cumples la condición.',
                icon: Icons.emoji_events_outlined,
                child: Column(
                  children: [
                    for (final item in rewards.items)
                      _RewardRow(item: item, currency: currency),
                  ],
                ),
              ),
              if (rewards.dailyCap != null && rewards.monthlyCap != null) ...[
                const SizedBox(height: 14),
                _RewardCaps(rewards: rewards, currency: currency),
              ],
              const SizedBox(height: 14),
              ReferralCard(
                services: services,
                rewardAmount: rewards.item(ActionKeys.referral)?.amount,
              ),
            ],
          );
        },
      ),
    ],
  );
}

class _RewardRow extends StatelessWidget {
  const _RewardRow({required this.item, required this.currency});

  final RewardItem item;
  final String currency;

  String get _condition {
    switch (item.actionKey) {
      case ActionKeys.profileComplete:
        return item.earned
            ? 'Completaste tu perfil.'
            : item.missingSections.isEmpty
            ? 'Tu perfil está completo.'
            : 'Te faltan ${item.missingSections.length} secciones del perfil.';
      case ActionKeys.documentVerified:
        final verified = item.documents.where((document) => document.verified).length;
        return 'Documentos verificados: $verified de ${item.documents.length}.';
      case ActionKeys.referral:
        final monthly = item.monthly;
        return monthly == null
            ? 'Cuando la persona que invitas completa su perfil.'
            : 'Cuando la persona que invitas completa su perfil. Este mes: ${monthly.used} de ${monthly.limit}.';
      case ActionKeys.invitationResponded:
        return 'Al aceptar o rechazar una invitación de una empresa a tiempo.';
      case ActionKeys.welcomeBonus:
        return item.earned ? 'Ya lo recibiste al registrarte.' : 'Se acredita al registrarte.';
      default:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final reward = formatCoins(item.amount, currency);
    final statusText = item.earned
        ? 'Ganado'
        : item.repeatable && item.earnedCount > 0
        ? 'Ganado ${item.earnedCount} ${item.earnedCount == 1 ? 'vez' : 'veces'}'
        : 'Disponible';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Semantics(
        container: true,
        label: '${actionLabel(item.actionKey)}: $reward. $statusText. $_condition',
        excludeSemantics: true,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              item.earned ? Icons.check_circle_rounded : Icons.card_giftcard_rounded,
              color: item.earned ? AppColors.teal : palette.muted,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    actionLabel(item.actionKey),
                    style: TextStyle(color: palette.ink, fontWeight: FontWeight.w800),
                  ),
                  if (_condition.isNotEmpty)
                    Text(_condition, style: TextStyle(color: palette.muted, fontSize: 12.5)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('+$reward', style: TextStyle(color: palette.ink, fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                StatusPill(
                  label: statusText,
                  color: item.earned ? AppColors.teal : AppColors.navy,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RewardCaps extends StatelessWidget {
  const _RewardCaps({required this.rewards, required this.currency});

  final Rewards rewards;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final daily = rewards.dailyCap!;
    final monthly = rewards.monthlyCap!;
    return SectionCard(
      title: 'Límite de premios',
      subtitle: 'Para evitar abusos, hay un máximo de lo que puedes ganar por premios.',
      icon: Icons.shield_outlined,
      child: Column(
        children: [
          FactRow(
            label: 'Hoy',
            value: 'Ganaste ${formatCoins(daily.earned, currency)} de ${formatCoins(daily.limit, currency)}',
          ),
          FactRow(
            label: 'Este mes',
            value: 'Ganaste ${formatCoins(monthly.earned, currency)} de ${formatCoins(monthly.limit, currency)}',
          ),
        ],
      ),
    );
  }
}

/// Código de referido propio con copiar y compartir (el mensaje se copia).
class ReferralCard extends StatelessWidget {
  const ReferralCard({super.key, required this.services, this.rewardAmount});

  final JobsServices services;
  final int? rewardAmount;

  @override
  Widget build(BuildContext context) => SectionCard(
    title: 'Invita y gana',
    icon: Icons.group_add_outlined,
    subtitle: rewardAmount == null
        ? 'Comparte tu código con otras personas.'
        : 'Ganas ${formatCoins(rewardAmount!, services.walletController.currencyName)} '
              'cuando la persona que registra tu código completa su perfil.',
    child: AsyncSection<Referral>(
      load: services.wallet.referral,
      errorTitle: 'No pudimos cargar tu código',
      loadingLabel: 'Cargando tu código de referido',
      builder: (context, referral) {
        final palette = context.palette;
        final message =
            'Únete a Chambeaya con mi código de referido ${referral.code} y encuentra tu próximo empleo.';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              label: 'Tu código de referido: ${referral.code.split('').join(' ')}',
              excludeSemantics: true,
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: palette.accentSoft,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Center(
                  child: SelectableText(
                    referral.code,
                    key: const Key('referral-code'),
                    style: TextStyle(
                      color: palette.ink,
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 4,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Personas que registraron tu código: ${referral.referred}. Con premio: ${referral.rewarded}.'
              '${referral.monthly == null ? '' : ' Referidos premiados este mes: ${referral.monthly!.used} de ${referral.monthly!.limit}.'}',
              style: TextStyle(color: palette.muted, fontSize: 13),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                OutlinedButton.icon(
                  key: const Key('copy-referral-code'),
                  onPressed: () => _copy(context, referral.code, 'Código copiado.'),
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Copiar código'),
                ),
                FilledButton.icon(
                  key: const Key('share-referral'),
                  onPressed: () => _copy(
                    context,
                    message,
                    'Mensaje copiado. Pégalo en WhatsApp o donde quieras compartirlo.',
                  ),
                  icon: const Icon(Icons.share_rounded),
                  label: const Text('Compartir mensaje'),
                ),
              ],
            ),
          ],
        );
      },
    ),
  );

  Future<void> _copy(BuildContext context, String text, String confirmation) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(confirmation)));
  }
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

class MovementsTab extends StatefulWidget {
  const MovementsTab({super.key, required this.services});

  final JobsServices services;

  @override
  State<MovementsTab> createState() => _MovementsTabState();
}

class _MovementsTabState extends State<MovementsTab> {
  final List<Movement> _items = [];
  final Set<String> _ids = {};
  String? _cursor;
  bool _loading = true;
  bool _loadingMore = false;
  JobsErrorInfo? _error;
  JobsErrorInfo? _moreError;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.services.wallet.movements();
      if (!mounted || generation != _generation) return;
      setState(() {
        _items.clear();
        _ids.clear();
        for (final item in page.items) {
          if (_ids.add(item.id)) _items.add(item);
        }
        _cursor = page.nextCursor;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = describeJobsError(error);
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final cursor = _cursor;
    if (cursor == null || _loadingMore) return;
    final generation = _generation;
    setState(() {
      _loadingMore = true;
      _moreError = null;
    });
    try {
      final page = await widget.services.wallet.movements(cursor: cursor);
      if (!mounted || generation != _generation) return;
      setState(() {
        for (final item in page.items) {
          if (_ids.add(item.id)) _items.add(item);
        }
        _cursor = page.nextCursor;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _moreError = describeJobsError(error);
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingPanel(label: 'Cargando movimientos');
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          StatePanel(
            icon: Icons.cloud_off_rounded,
            title: 'No pudimos cargar tus movimientos',
            message: _error!.message,
            actionLabel: 'Reintentar',
            onAction: _load,
          ),
        ],
      );
    }
    final currency = widget.services.walletController.currencyName;
    if (_items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          StatePanel(
            icon: Icons.receipt_long_outlined,
            title: 'Todavía no tienes movimientos',
            message: 'Aquí verás cada gasto, premio y devolución de tu saldo.',
          ),
        ],
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
        children: [
          for (final movement in _items) _MovementTile(movement: movement, currency: currency),
          if (_loadingMore) const LoadingPanel(label: 'Cargando más movimientos'),
          if (_moreError != null)
            StatePanel(
              icon: Icons.cloud_off_rounded,
              title: 'No pudimos cargar más',
              message: _moreError!.message,
              actionLabel: 'Reintentar',
              onAction: _loadMore,
            )
          else if (_cursor != null && !_loadingMore)
            Center(
              child: OutlinedButton(
                key: const Key('load-more-movements'),
                onPressed: _loadMore,
                child: const Text('Cargar más movimientos'),
              ),
            ),
        ],
      ),
    );
  }
}

String movementKindLabel(MovementAction action) => switch (action) {
  MovementAction.charge => 'Gasto',
  MovementAction.refund => 'Devolución',
  MovementAction.reward => 'Premio',
  MovementAction.adjustment => 'Ajuste',
  MovementAction.unknown => 'Movimiento',
};

class _MovementTile extends StatelessWidget {
  const _MovementTile({required this.movement, required this.currency});

  final Movement movement;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final positive = movement.quantity >= 0;
    final amount = '${positive ? '+' : '-'}${formatCoins(movement.quantity.abs(), currency)}';
    final kind = movementKindLabel(movement.action);
    final title = movement.actionKey != null
        ? actionLabel(movement.actionKey)
        : kind;
    return Semantics(
      container: true,
      label: '$kind: $title, $amount, ${formatDateTime(movement.createdAt)}, '
          'saldo resultante ${formatCoins(movement.balanceAfter, currency)}',
      excludeSemantics: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border.all(color: palette.border),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              positive ? Icons.arrow_circle_up_rounded : Icons.arrow_circle_down_rounded,
              color: positive ? AppColors.teal : palette.muted,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(color: palette.ink, fontWeight: FontWeight.w800)),
                  Text(
                    '$kind · ${formatDateTime(movement.createdAt)}',
                    style: TextStyle(color: palette.muted, fontSize: 12.5),
                  ),
                  if (movement.reason != null && movement.reason!.trim().isNotEmpty)
                    Text(movement.reason!, style: TextStyle(color: palette.muted, fontSize: 12.5)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(amount, style: TextStyle(color: palette.ink, fontWeight: FontWeight.w900)),
                Text(
                  'Saldo: ${formatCoins(movement.balanceAfter, currency)}',
                  style: TextStyle(color: palette.muted, fontSize: 12),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
