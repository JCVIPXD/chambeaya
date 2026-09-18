import 'package:flutter/material.dart';

import '../../../core/formatters/currency_formatter.dart';
import '../../../theme/app_theme.dart';
import '../../marketplace/marketplace_data.dart';
import '../discovery_models.dart';

class JobDetailPanel extends StatelessWidget {
  const JobDetailPanel({
    super.key,
    required this.shift,
    required this.saved,
    required this.applicationState,
    required this.onToggleSaved,
    required this.onApply,
  });

  final Shift shift;
  final bool saved;
  final ApplicationState applicationState;
  final VoidCallback onToggleSaved;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final applied = applicationState != ApplicationState.notApplied;
    return ColoredBox(
      color: context.palette.surfaceMuted,
      child: Column(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) => ListView(
                padding: EdgeInsets.fromLTRB(
                  constraints.maxWidth > 900 ? 34 : 24,
                  24,
                  constraints.maxWidth > 900 ? 34 : 24,
                  20,
                ),
                children: [
                  _Hero(
                    shift: shift,
                    saved: saved,
                    onToggleSaved: onToggleSaved,
                  ),
                  const SizedBox(height: 18),
                  _FactsGrid(shift: shift),
                  const SizedBox(height: 18),
                  _DetailContent(shift: shift),
                ],
              ),
            ),
          ),
          _ApplyBar(applied: applied, onApply: onApply),
        ],
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({
    required this.shift,
    required this.saved,
    required this.onToggleSaved,
  });

  final Shift shift;
  final bool saved;
  final VoidCallback onToggleSaved;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(22),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [AppColors.navy, Color(0xFF29466F)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(24),
      boxShadow: const [
        BoxShadow(
          color: AppColors.shadow,
          blurRadius: 22,
          offset: Offset(0, 9),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'Detalle del turno',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Color(0xFFD8E2F0),
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                      letterSpacing: .7,
                    ),
                  ),
                ),
              ),
            ),
            if (shift.urgent) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFE8EC),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'URGENTE',
                  style: TextStyle(
                    color: Color(0xFFD9344B),
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
            Semantics(
              label: saved ? 'Empleo guardado' : 'Guardar empleo',
              button: true,
              child: IconButton(
                onPressed: onToggleSaved,
                tooltip: saved ? 'Empleo guardado' : 'Guardar empleo',
                style: IconButton.styleFrom(
                  backgroundColor: Colors.white.withValues(alpha: .12),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(48, 48),
                ),
                icon: Icon(
                  saved
                      ? Icons.bookmark_rounded
                      : Icons.bookmark_border_rounded,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 54,
              height: 54,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.teal,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(
                shift.company.characters.first.toUpperCase(),
                style: const TextStyle(
                  color: AppColors.navy,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const SizedBox(width: 15),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    shift.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 25,
                      fontWeight: FontWeight.w900,
                      height: 1.12,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 6,
                    runSpacing: 5,
                    children: [
                      Text(
                        shift.company,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Icon(
                        shift.companyVerified
                            ? Icons.verified_rounded
                            : Icons.info_outline_rounded,
                        color: shift.companyVerified
                            ? AppColors.teal
                            : AppColors.gold,
                        size: 17,
                      ),
                      Text(
                        shift.companyVerified
                            ? 'Empresa verificada'
                            : 'Datos declarados por la empresa',
                        style: const TextStyle(
                          color: Color(0xFFD8E2F0),
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        if (shift.match != null) ...[
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: shift.match! / 100,
                    minHeight: 7,
                    backgroundColor: Colors.white.withValues(alpha: .16),
                    color: AppColors.teal,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${shift.match}% compatible contigo',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ],
      ],
    ),
  );
}

class _FactsGrid extends StatelessWidget {
  const _FactsGrid({required this.shift});
  final Shift shift;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = constraints.maxWidth >= 760 ? 4 : 2;
      final width = (constraints.maxWidth - ((columns - 1) * 10)) / columns;
      return Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          _Fact(
            width: width,
            icon: Icons.payments_outlined,
            label: 'PAGO POR TURNO',
            value: formatPenCents(shift.workerPayCents),
            hint: 'Monto confirmado',
          ),
          _Fact(
            width: width,
            icon: Icons.schedule_outlined,
            label: 'HORARIO',
            value: shift.schedule,
            hint: 'Turno definido',
          ),
          _Fact(
            width: width,
            icon: Icons.location_on_outlined,
            label: 'UBICACIÓN',
            value: shift.location,
            hint: 'Ver ruta al aceptar',
          ),
          _Fact(
            width: width,
            icon: Icons.work_outline_rounded,
            label: 'MODALIDAD',
            value: _modalityLabel(shift.modality),
            hint: _industryLabel(shift.industry),
          ),
        ],
      );
    },
  );
}

class _Fact extends StatelessWidget {
  const _Fact({
    required this.width,
    required this.icon,
    required this.label,
    required this.value,
    required this.hint,
  });

  final double width;
  final IconData icon;
  final String label;
  final String value;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      width: width,
      constraints: const BoxConstraints(minHeight: 112),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(17),
        boxShadow: [
          BoxShadow(
            color: palette.shadow,
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: palette.accentSoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: AppColors.tealDark, size: 18),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  style: TextStyle(
                    color: palette.muted,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .4,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: palette.ink,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            hint,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: palette.muted, fontSize: 9),
          ),
        ],
      ),
    );
  }
}

class _DetailContent extends StatelessWidget {
  const _DetailContent({required this.shift});
  final Shift shift;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final about = _AboutCard(shift: shift);
      const confidence = _ConfidenceCard();
      if (constraints.maxWidth >= 720) {
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 3, child: about),
            const SizedBox(width: 14),
            const Expanded(flex: 2, child: confidence),
          ],
        );
      }
      return Column(children: [about, const SizedBox(height: 14), confidence]);
    },
  );
}

class _AboutCard extends StatelessWidget {
  const _AboutCard({required this.shift});
  final Shift shift;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return _SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionTitle(
            icon: Icons.description_outlined,
            title: 'Sobre este trabajo',
          ),
          const SizedBox(height: 12),
          Text(
            shift.description?.trim().isNotEmpty == true
                ? shift.description!.trim()
                : 'Buscamos una persona responsable y orientada al servicio para apoyar al equipo durante este turno. El horario, las tareas y el pago ya están confirmados.',
            style: TextStyle(color: palette.muted, height: 1.5, fontSize: 12),
          ),
          const SizedBox(height: 17),
          Text(
            'Lo que harás',
            style: TextStyle(
              color: palette.ink,
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 9),
          ..._linesOrFallback(
            shift.responsibilities,
            _tasksFor(shift.industry),
          ).map((task) => _TaskRow(label: task)),
          if (shift.requirements?.trim().isNotEmpty == true) ...[
            const SizedBox(height: 17),
            Text(
              'Requisitos',
              style: TextStyle(
                color: palette.ink,
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 9),
            ..._linesOrFallback(
              shift.requirements,
              const <String>[],
            ).map((requirement) => _TaskRow(label: requirement)),
          ],
          if (shift.screeningQuestions.isNotEmpty) ...[
            const SizedBox(height: 17),
            Text(
              'Preguntas antes de postular',
              style: TextStyle(
                color: palette.ink,
                fontSize: 12,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 9),
            ...shift.screeningQuestions.map(
              (question) => _TaskRow(label: question),
            ),
          ],
        ],
      ),
    );
  }

  static List<String> _tasksFor(ShiftIndustry industry) {
    if (industry == ShiftIndustry.foodService ||
        industry == ShiftIndustry.hospitality) {
      return const [
        'Preparar el área antes de iniciar el servicio.',
        'Atender y orientar a los clientes con agilidad.',
        'Coordinar con el equipo durante todo el turno.',
      ];
    }
    return const [
      'Revisar las indicaciones antes de iniciar.',
      'Apoyar al equipo durante todo el turno.',
      'Confirmar la finalización de tus tareas.',
    ];
  }

  static List<String> _linesOrFallback(String? value, List<String> fallback) {
    final lines = value
        ?.split(RegExp(r'\r?\n|•|;'))
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    return lines?.isNotEmpty == true ? lines! : fallback;
  }
}

String _modalityLabel(String modality) => switch (modality) {
  'REMOTO' => 'Remoto',
  'HIBRIDO' => 'Híbrido',
  _ => 'Presencial',
};

String _industryLabel(ShiftIndustry industry) => switch (industry) {
  ShiftIndustry.hospitality => 'Hospitalidad',
  ShiftIndustry.foodService => 'Gastronomía',
  ShiftIndustry.retail => 'Retail',
  ShiftIndustry.events => 'Eventos',
};

class _ConfidenceCard extends StatelessWidget {
  const _ConfidenceCard();

  @override
  Widget build(BuildContext context) => _SurfaceCard(
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionTitle(
          icon: Icons.shield_outlined,
          title: 'Postula con confianza',
        ),
        SizedBox(height: 14),
        _TrustRow(
          icon: Icons.verified_user_outlined,
          title: 'Datos de la empresa',
          subtitle: 'La verificación oficial se habilitará próximamente.',
        ),
        SizedBox(height: 13),
        _TrustRow(
          icon: Icons.lock_outline_rounded,
          title: 'Pago informado',
          subtitle: 'El monto indicado se confirma antes de postular.',
        ),
        SizedBox(height: 13),
        _TrustRow(
          icon: Icons.support_agent_rounded,
          title: 'Canal de ayuda',
          subtitle: 'Las consultas del turno se coordinan en la conversación.',
        ),
      ],
    ),
  );
}

class _SurfaceCard extends StatelessWidget {
  const _SurfaceCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(19),
        boxShadow: [
          BoxShadow(
            color: palette.shadow,
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title});
  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 35,
        height: 35,
        decoration: BoxDecoration(
          color: context.palette.accentSoft,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: AppColors.tealDark, size: 19),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: Text(
          title,
          style: TextStyle(
            color: context.palette.ink,
            fontSize: 15,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    ],
  );
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            color: context.palette.accentSoft,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.check_rounded,
            color: AppColors.tealDark,
            size: 13,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: context.palette.ink,
              fontSize: 11,
              height: 1.4,
            ),
          ),
        ),
      ],
    ),
  );
}

class _TrustRow extends StatelessWidget {
  const _TrustRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, color: AppColors.tealDark, size: 20),
      const SizedBox(width: 9),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                color: context.palette.ink,
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: TextStyle(
                color: context.palette.muted,
                fontSize: 9,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

class _ApplyBar extends StatelessWidget {
  const _ApplyBar({required this.applied, required this.onApply});
  final bool applied;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact =
          constraints.maxWidth < 520 ||
          MediaQuery.textScalerOf(context).scale(1) > 1.3;
      final palette = context.palette;
      final message = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Postulación segura',
            style: TextStyle(
              color: palette.ink,
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Tus datos se comparten solo al postular',
            maxLines: 2,
            style: TextStyle(color: palette.muted, fontSize: 9),
          ),
        ],
      );
      final button = Semantics(
        label: applied ? 'Postulación enviada' : 'Postular ahora',
        button: !applied,
        child: FilledButton.icon(
          onPressed: applied ? null : onApply,
          icon: Icon(
            applied ? Icons.check_circle_outline_rounded : Icons.send_outlined,
          ),
          label: Text(applied ? 'Postulación enviada' : 'Postular ahora'),
        ),
      );
      return Container(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border(top: BorderSide(color: palette.border)),
          boxShadow: [
            BoxShadow(
              color: palette.shadow,
              blurRadius: 18,
              offset: const Offset(0, -5),
            ),
          ],
        ),
        child: SafeArea(
          top: false,
          child: compact
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [message, const SizedBox(height: 10), button],
                )
              : Row(
                  children: [
                    Expanded(child: message),
                    const SizedBox(width: 16),
                    ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: 190),
                      child: button,
                    ),
                  ],
                ),
        ),
      );
    },
  );
}
