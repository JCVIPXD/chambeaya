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
  const JobsServices({
    required this.jobs,
    required this.wallet,
    required this.walletController,
    required this.events,
    this.onClose,
  });

  /// Servicios reales contra la API con el token de la sesión. El cliente se
  /// puede inyectar (pruebas con `MockClient`); si no, los servicios crean
  /// el suyo y lo cierran en [dispose]. [onSessionExpired] se llama ante un
  /// `401` de cualquier ruta (solo con el cliente propio).
  factory JobsServices.http({
    required String? token,
    ApiClient? api,
    void Function()? onSessionExpired,
  }) {
    final client = api ?? ApiClient(token: token, onUnauthorized: onSessionExpired);
    final wallet = HttpWalletRepository(api: client);
    return JobsServices(
      jobs: HttpJobsRepository(api: client),
      wallet: wallet,
      walletController: WalletController(wallet),
      events: HttpJobEventsSource(api: client),
      onClose: api == null ? client.close : null,
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
  final JobEventsSource events;

  /// Cierra el cliente HTTP propio de estos servicios (si lo hay).
  final void Function()? onClose;

  /// Libera lo que la sesión mantiene vivo: el saldo compartido y el cliente
  /// HTTP (uno por inicio de sesión).
  void dispose() {
    walletController.dispose();
    onClose?.call();
  }
}
