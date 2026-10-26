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
  });

  /// Servicios reales contra la API con el token de la sesión. El cliente se
  /// puede inyectar (pruebas con `MockClient`).
  factory JobsServices.http({required String? token, ApiClient? api}) {
    final client = api ?? ApiClient(token: token);
    final wallet = HttpWalletRepository(api: client);
    return JobsServices(
      jobs: HttpJobsRepository(api: client),
      wallet: wallet,
      walletController: WalletController(wallet),
      events: HttpJobEventsSource(api: client),
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

  /// Libera lo que la sesión mantiene vivo (el saldo compartido).
  void dispose() => walletController.dispose();
}
