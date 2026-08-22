String formatPenCents(int cents) {
  final amount = cents / 100;
  return amount == amount.roundToDouble()
      ? 'S/ ${amount.toStringAsFixed(0)}'
      : 'S/ ${amount.toStringAsFixed(2)}';
}
