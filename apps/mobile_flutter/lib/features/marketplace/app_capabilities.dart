class AppCapabilities {
  const AppCapabilities({
    required this.cameraCheckInEnabled,
    required this.locationCheckInEnabled,
    required this.paymentsEnabled,
  });

  static const defaults = AppCapabilities(
    cameraCheckInEnabled: false,
    locationCheckInEnabled: false,
    paymentsEnabled: false,
  );

  final bool cameraCheckInEnabled;
  final bool locationCheckInEnabled;
  final bool paymentsEnabled;
}
