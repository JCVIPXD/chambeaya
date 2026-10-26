import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../jobs/jobs_format.dart';
import '../jobs/jobs_services.dart';
import '../profile/talent_profile_repository.dart';
import 'wallet_sections.dart';

/// Abre la billetera como una pantalla aparte (desde un aviso de saldo
/// insuficiente, el chip de saldo, etc.).
Future<void> openWalletPage(
  BuildContext context,
  JobsServices services, {
  TalentProfileRepository? profileRepository,
}) => Navigator.of(context).push<void>(
  MaterialPageRoute(
    builder: (_) => WalletPage(
      services: services,
      profileRepository: profileRepository,
      showBack: true,
    ),
  ),
);

/// Billetera del trabajador: saldo, costos, premios, referidos, destacar el
/// perfil y movimientos. Cada pestaña carga y falla por separado.
class WalletPage extends StatefulWidget {
  const WalletPage({
    super.key,
    required this.services,
    this.profileRepository,
    this.showBack = false,
  });

  final JobsServices services;
  final TalentProfileRepository? profileRepository;

  /// `true` cuando se abre como pantalla aparte (con barra superior y volver).
  final bool showBack;

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  @override
  void initState() {
    super.initState();
    widget.services.walletController
      ..addListener(_onWallet)
      ..refresh();
  }

  void _onWallet() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.services.walletController.removeListener(_onWallet);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final body = DefaultTabController(
      length: 3,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 820),
                child: _BalanceCard(services: widget.services),
              ),
            ),
          ),
          TabBar(
            labelColor: palette.ink,
            unselectedLabelColor: palette.muted,
            indicatorColor: AppColors.teal,
            tabs: const [
              Tab(text: 'Resumen'),
              Tab(text: 'Ganar'),
              Tab(text: 'Movimientos'),
            ],
          ),
          Expanded(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 820),
                child: TabBarView(
                  children: [
                    SummaryTab(
                      services: widget.services,
                      profileRepository: widget.profileRepository,
                    ),
                    RewardsTab(services: widget.services),
                    MovementsTab(services: widget.services),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
    if (widget.showBack) {
      return Scaffold(appBar: AppBar(title: const Text('Mi billetera')), body: SafeArea(child: body));
    }
    return Material(
      color: palette.background,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Semantics(
                  header: true,
                  child: Text(
                    'Mi billetera',
                    style: TextStyle(color: palette.ink, fontSize: 28, fontWeight: FontWeight.w900),
                  ),
                ),
              ),
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.services});

  final JobsServices services;

  @override
  Widget build(BuildContext context) {
    final controller = services.walletController;
    final balance = controller.balance;
    return Semantics(
      container: true,
      liveRegion: true,
      label: balance == null
          ? 'Saldo no disponible'
          : 'Tu saldo es ${formatCoins(balance, controller.currencyName)}',
      excludeSemantics: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [AppColors.navy, Color(0xFF243E68)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Row(
          children: [
            const Icon(Icons.account_balance_wallet_outlined, color: AppColors.gold, size: 32),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Tu saldo',
                    style: TextStyle(color: Color(0xFFD8E2F0), fontSize: 13),
                  ),
                  if (controller.loading && balance == null)
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      ),
                    )
                  else if (balance == null)
                    Text(
                      controller.error?.message ?? 'No pudimos leer tu saldo.',
                      style: const TextStyle(color: Colors.white),
                    )
                  else
                    Text(
                      formatCoins(balance, controller.currencyName),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Actualizar saldo',
              color: Colors.white,
              style: IconButton.styleFrom(minimumSize: const Size(48, 48)),
              onPressed: controller.loading ? null : controller.refresh,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
      ),
    );
  }
}
