import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import 'job_postings_page.dart';
import 'jobs_services.dart';
import 'my_applications_page.dart';
import 'pdf_saver.dart';

/// Puestos fijos en una sola pestaña (Explorar y Mis postulaciones). Solo se
/// usa cuando los turnos temporales están encendidos y la barra ya tiene sus
/// pestañas heredadas; con ellos apagados cada una es una pestaña propia.
class JobsHubPage extends StatefulWidget {
  const JobsHubPage({
    super.key,
    required this.services,
    this.pdfSaver = savePdfWithPicker,
  });

  final JobsServices services;
  final PdfSaver pdfSaver;

  @override
  State<JobsHubPage> createState() => _JobsHubPageState();
}

class _JobsHubPageState extends State<JobsHubPage> {
  var _revision = 0;

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return DefaultTabController(
      length: 2,
      child: Material(
        color: palette.background,
        child: SafeArea(
          child: Column(
            children: [
              TabBar(
                labelColor: palette.ink,
                unselectedLabelColor: palette.muted,
                indicatorColor: AppColors.teal,
                tabs: const [
                  Tab(text: 'Explorar puestos'),
                  Tab(text: 'Mis procesos'),
                ],
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    JobPostingsPage(
                      services: widget.services,
                      onApplicationChanged: () => setState(() => _revision++),
                    ),
                    MyApplicationsPage(
                      services: widget.services,
                      revision: _revision,
                      pdfSaver: widget.pdfSaver,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
