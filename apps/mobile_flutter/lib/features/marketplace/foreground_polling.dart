import 'dart:async';

import 'package:flutter/widgets.dart';

/// Periodic polling that only runs while the app is in the foreground.
///
/// A poll that keeps firing with the app in the background wastes battery and
/// data for a screen nobody sees (and on a phone the OS may even keep the
/// process alive just for it). This mixin owns the [Timer] and the lifecycle
/// subscription: the timer is cancelled as soon as the app goes to the
/// background (`paused`, `hidden` or `detached`) and, when the app comes back,
/// it is restarted and one catch-up tick runs immediately so the screen is not
/// up to a full interval stale.
///
/// `inactive` (the app switcher, a system dialog, a call banner, or a desktop
/// window that lost focus) is deliberately treated as still in the foreground:
/// it is transient, the UI is still visible, and pausing there would freeze
/// the list for a user who is looking at it.
///
/// Usage: `startForegroundPolling()` in `initState`, `stopForegroundPolling()`
/// in `dispose`, and implement [pollInterval] and [onPollTick]. [onPollTick] is
/// never called while the app is in the background.
mixin ForegroundPolling<T extends StatefulWidget> on State<T> {
  /// Time between two ticks while the app is in the foreground.
  Duration get pollInterval;

  /// One poll tick (also the catch-up tick when the app returns to the
  /// foreground). Guard against in-flight requests here, as before.
  void onPollTick();

  Timer? _pollTimer;
  late final _ForegroundObserver _observer = _ForegroundObserver(
    _onLifecycleChanged,
  );
  var _appInForeground = true;
  var _polling = false;

  /// False while the app is in the background.
  bool get appInForeground => _appInForeground;

  /// Whether the periodic timer is currently armed (test/diagnostic aid).
  @visibleForTesting
  bool get isPollTimerActive => _pollTimer?.isActive ?? false;

  void startForegroundPolling() {
    if (_polling) return;
    _polling = true;
    _appInForeground = !_isBackground(WidgetsBinding.instance.lifecycleState);
    WidgetsBinding.instance.addObserver(_observer);
    if (_appInForeground) _armTimer();
  }

  void stopForegroundPolling() {
    _polling = false;
    _pollTimer?.cancel();
    _pollTimer = null;
    WidgetsBinding.instance.removeObserver(_observer);
  }

  void _armTimer() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(pollInterval, (_) {
      if (mounted && _appInForeground) onPollTick();
    });
  }

  void _onLifecycleChanged(AppLifecycleState state) {
    if (!_polling) return;
    final foreground = !_isBackground(state);
    if (foreground == _appInForeground) return;
    _appInForeground = foreground;
    if (!foreground) {
      _pollTimer?.cancel();
      _pollTimer = null;
      return;
    }
    if (!mounted) return;
    _armTimer();
    onPollTick();
  }

  static bool _isBackground(AppLifecycleState? state) =>
      state == AppLifecycleState.paused ||
      state == AppLifecycleState.hidden ||
      state == AppLifecycleState.detached;
}

class _ForegroundObserver with WidgetsBindingObserver {
  _ForegroundObserver(this._onChanged);

  final void Function(AppLifecycleState state) _onChanged;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      _onChanged(state);
}
