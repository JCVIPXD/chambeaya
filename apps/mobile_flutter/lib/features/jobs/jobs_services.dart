import 'package:http/http.dart' as http;

import '../wallet/wallet_controller.dart';
import '../wallet/wallet_repository.dart';
import 'api_client.dart';
import 'demo_jobs_backend.dart';
import 'job_events_source.dart';
import 'jobs_repository.dart';

/// Dependencias compartidas por las pantallas de puestos fijos y billetera:
/// los repositorios (reales o simulados), el saldo compartido y el flujo de
/// avisos en vivo. Se arma una vez por sesión en `main.dart`.
class JobsServices {
  /// [events] se envuelve en un único flujo compartido (broadcast): todas las
  /// pantallas escuchan la misma conexión de avisos.
  JobsServices({
    required this.jobs,
    required this.wallet,
    required this.walletController,
    required JobEventsSource events,
    this.onClose,
  }) : events = SharedJobEventsSource(events);

  /// Servicios reales contra la API con el token de la sesión. El cliente se
  /// puede inyectar (pruebas con `MockClient`); si no, los servicios crean
  /// el suyo y lo cierran en [dispose]. [onSessionExpired] se llama ante un
  /// `401` de cualquier ruta (solo con el cliente propio).
  factory JobsServices.http({
    required String? token,
    ApiClient? api,
    http.Client? httpClient,
    void Function()? onSessionExpired,
  }) {
    final client =
        api ??
        ApiClient(
          client: httpClient,
          token: token,
          onUnauthorized: onSessionExpired,
        );
    final wallet = HttpWalletRepository(api: client);
    return JobsServices(
      jobs: HttpJobsRepository(api: client),
      wallet: wallet,
      walletController: WalletController(wallet),
      events: HttpJobEventsSource(api: client),
      onClose: api == null && httpClient == null ? client.close : null,
    );
  }

  /// Servicios en memoria (modo demostración y pruebas).
  factory JobsServices.demo([DemoJobsBackend? backend]) {
    final source = backend ?? DemoJobsBackend();
    return JobsServices(
      jobs: source,
      wallet: source,
      walletController: WalletController(source),
      events: source,
    );
  }

  final JobsRepository jobs;
  final WalletRepository wallet;
  final WalletController walletController;
  final SharedJobEventsSource events;

  /// Cierra el cliente HTTP propio de estos servicios (si lo hay).
  final void Function()? onClose;

  /// Libera lo que la sesión mantiene vivo: el saldo compartido y el cliente
  /// HTTP (uno por inicio de sesión).
  void dispose() {
    events.close();
    walletController.dispose();
    onClose?.call();
  }
}
