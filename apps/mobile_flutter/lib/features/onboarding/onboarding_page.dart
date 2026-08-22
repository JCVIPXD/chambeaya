import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

enum AppAudience { worker, company }

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({required this.onComplete, super.key});
  final ValueChanged<AppAudience> onComplete;

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  var step = 0;
  static const steps = [
    (
      Icons.verified_user_outlined,
      'Trabajadores verificados',
      'Solo perfiles validados acceden a oportunidades confiables.',
    ),
    (
      Icons.insights_outlined,
      'Índice CUMPLE',
      'La puntualidad, asistencia y desempeño construyen tu reputación.',
    ),
    (
      Icons.account_balance_wallet_outlined,
      'Pagos protegidos',
      'El pago se libera al terminar y validar el turno.',
    ),
    (
      Icons.bolt_rounded,
      'IA para cubrir turnos',
      'Cuando hay una urgencia, encontramos el mejor reemplazo en minutos.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final item = steps[step];
    final isLast = step == steps.length - 1;
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                key: const Key('onboarding-content'),
                constraints: BoxConstraints(
                  maxWidth: 560,
                  minHeight: constraints.maxHeight - 48,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'CUMPLE',
                      style: TextStyle(
                        color: AppColors.navy,
                        fontSize: 30,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -1,
                      ),
                    ),
                    const Text(
                      'NOW',
                      style: TextStyle(
                        color: AppColors.teal,
                        fontSize: 30,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -1,
                      ),
                    ),
                    const SizedBox(height: 42),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(30),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(28),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Column(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(20),
                            decoration: const BoxDecoration(
                              color: AppColors.tealSoft,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              item.$1,
                              size: 54,
                              color: AppColors.teal,
                            ),
                          ),
                          const SizedBox(height: 24),
                          Text(
                            item.$2,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            item.$3,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: AppColors.muted,
                              height: 1.45,
                            ),
                          ),
                          const SizedBox(height: 26),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: List.generate(
                              steps.length,
                              (index) => Container(
                                margin: const EdgeInsets.symmetric(
                                  horizontal: 4,
                                ),
                                height: 8,
                                width: index == step ? 24 : 8,
                                decoration: BoxDecoration(
                                  color: index == step
                                      ? AppColors.teal
                                      : AppColors.border,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 24),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: () => isLast
                                  ? widget.onComplete(AppAudience.worker)
                                  : setState(() => step++),
                              child: Text(isLast ? 'Empezar' : 'Siguiente'),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () =>
                                widget.onComplete(AppAudience.worker),
                            child: const Text('Soy trabajador'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.navy,
                              foregroundColor: Colors.white,
                            ),
                            onPressed: () =>
                                widget.onComplete(AppAudience.company),
                            child: const Text('Soy empresa'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
