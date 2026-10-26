import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../wallet/cost_flow.dart';
import '../wallet/wallet_models.dart';
import '../wallet/wallet_page.dart';
import 'jobs_errors.dart';
import 'jobs_models.dart';
import 'jobs_services.dart';
import 'jobs_widgets.dart';

/// Hoja para postular (o volver a postular) a un puesto.
///
/// Orden: respuestas de la empresa -> cotización de costos -> confirmación
/// solo si algo cuesta -> envío. El botón queda deshabilitado mientras se
/// envía (sin doble toque) y un reintento reutiliza la misma petición: el
/// servidor es idempotente, así que nunca cobra dos veces.
Future<ApplyResult?> showApplySheet(
  BuildContext context, {
  required JobsServices services,
  required JobPosting posting,
  bool reapplying = false,
}) => showModalBottomSheet<ApplyResult>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => ApplySheet(
    services: services,
    posting: posting,
    reapplying: reapplying,
  ),
);

class ApplySheet extends StatefulWidget {
  const ApplySheet({
    super.key,
    required this.services,
    required this.posting,
    this.reapplying = false,
  });

  final JobsServices services;
  final JobPosting posting;
  final bool reapplying;

  @override
  State<ApplySheet> createState() => _ApplySheetState();
}

class _ApplySheetState extends State<ApplySheet> {
  final _formKey = GlobalKey<FormState>();
  late final List<TextEditingController> _answers = [
    for (final _ in widget.posting.screeningQuestions) TextEditingController(),
  ];
  var _priority = false;
  var _submitting = false;
  JobsErrorInfo? _error;

  // Se fija cuando el usuario ya aceptó los costos: un reintento tras un 503
  // no vuelve a preguntar ni cambia lo aceptado.
  bool? _acceptedPriority;

  @override
  void dispose() {
    for (final controller in _answers) {
      controller.dispose();
    }
    super.dispose();
  }

  String get _currency => widget.services.walletController.currencyName;

  Future<void> _submit() async {
    if (_submitting) return;
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      if (_acceptedPriority == null) {
        final result = await confirmCosts(
          context,
          wallet: widget.services.wallet,
          currencyName: _currency,
          title: widget.reapplying ? 'Volver a postular' : 'Confirmar postulación',
          requests: [
            CostRequest(
              actionKey: ActionKeys.applicationExtra,
              label: 'Postulación',
              targetId: widget.posting.id,
            ),
            if (_priority)
              const CostRequest(
                actionKey: ActionKeys.applicationPriority,
                label: 'Prioridad',
                optional: true,
              ),
          ],
          onOpenWallet: () => openWalletPage(context, widget.services),
          onCurrency: widget.services.walletController.adoptCurrencyName,
        );
        if (!mounted) return;
        if (!result.proceed) {
          setState(() => _submitting = false);
          return;
        }
        _acceptedPriority = _priority && !result.droppedOptional;
      }
      await _send();
    } catch (error) {
      _fail(error);
    }
  }

  /// Reintento tras un error: si el costo ya se aceptó, solo se repite el envío.
  Future<void> _retry() async {
    if (_acceptedPriority == null) return _submit();
    if (_submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    await _send();
  }

  Future<void> _send() async {
    try {
      final result = await widget.services.jobs.apply(
        widget.posting.id,
        answers: [
          for (var i = 0; i < _answers.length; i++)
            ScreeningAnswer(
              question: widget.posting.screeningQuestions[i],
              answer: _answers[i].text.trim(),
            ),
        ],
        priority: _acceptedPriority ?? false,
      );
      // El saldo cambió si se cobró algo.
      widget.services.walletController.refresh();
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } catch (error) {
      _fail(error);
    }
  }

  void _fail(Object error) {
    if (!mounted) return;
    setState(() {
      _submitting = false;
      _error = describeJobsError(error, currency: _currency);
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final questions = widget.posting.screeningQuestions;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          0,
          20,
          20 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    widget.reapplying ? 'Volver a postular' : 'Postular al puesto',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${widget.posting.title} · ${widget.posting.companyName}',
                  style: TextStyle(color: palette.muted),
                ),
                const SizedBox(height: 16),
                if (questions.isEmpty)
                  Text(
                    'Esta empresa no te hace preguntas previas. Tu perfil y tu CV '
                    'acompañan la postulación.',
                    style: TextStyle(color: palette.ink),
                  )
                else ...[
                  Text(
                    'Responde las preguntas de la empresa',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  for (var i = 0; i < questions.length; i++) ...[
                    const SizedBox(height: 12),
                    TextFormField(
                      key: Key('screening-answer-$i'),
                      controller: _answers[i],
                      enabled: !_submitting,
                      maxLength: 1000,
                      minLines: 2,
                      maxLines: 5,
                      textInputAction: TextInputAction.newline,
                      decoration: InputDecoration(labelText: questions[i]),
                      validator: (value) => value == null || value.trim().isEmpty
                          ? 'Responde esta pregunta'
                          : null,
                    ),
                  ],
                ],
                const SizedBox(height: 8),
                SwitchListTile(
                  key: const Key('priority-switch'),
                  contentPadding: EdgeInsets.zero,
                  value: _priority,
                  onChanged: _submitting || _acceptedPriority != null
                      ? null
                      : (value) => setState(() => _priority = value),
                  title: const Text('Postular con prioridad'),
                  subtitle: const Text(
                    'La empresa ve tu postulación primero. Es opcional y puede '
                    'tener un costo: lo verás antes de confirmar.',
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  ErrorNotice(
                    info: _error!,
                    onRetry: _submitting ? null : _retry,
                    onOpenWallet: () => openWalletPage(context, widget.services),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  key: const Key('submit-application'),
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(widget.reapplying ? 'Volver a postular' : 'Enviar postulación'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
