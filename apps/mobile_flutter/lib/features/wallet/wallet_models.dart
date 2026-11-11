// Modelos de la billetera del trabajador (moneda virtual M1, M2, M4 y M6).
// El NOMBRE de la moneda llega siempre desde la API (`currency`): nunca se
// fija en la aplicación.

String _string(Object? value, [String fallback = '']) =>
    value is String ? value : fallback;

int _int(Object? value, [int fallback = 0]) =>
    value is num ? value.toInt() : fallback;

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : const {};

List<dynamic> _list(Object? value) => value is List ? value : const [];

class Balance {
  const Balance({required this.currency, required this.balance});

  final String currency;
  final int balance;

  factory Balance.fromJson(Map<String, dynamic> json) => Balance(
    currency: _string(json['currency']),
    balance: _int(json['balance']),
  );
}

enum MovementAction {
  charge,
  refund,
  reward,
  adjustment,
  unknown;

  static MovementAction parse(Object? value) => switch (value) {
    'ACTION_CHARGE' => charge,
    'ACTION_REFUND' => refund,
    'REWARD' => reward,
    'ADMIN_ADJUSTMENT' => adjustment,
    _ => unknown,
  };
}

class Movement {
  const Movement({
    required this.id,
    required this.quantity,
    required this.balanceAfter,
    required this.action,
    required this.actionKey,
    required this.reason,
    required this.createdAt,
  });

  final String id;

  /// Con signo: negativo es gasto, positivo es premio, devolución o ajuste.
  final int quantity;
  final int balanceAfter;
  final MovementAction action;
  final String? actionKey;
  final String? reason;
  final DateTime createdAt;

  factory Movement.fromJson(Map<String, dynamic> json) => Movement(
    id: _string(json['id']),
    quantity: _int(json['quantity']),
    balanceAfter: _int(json['balanceAfter']),
    action: MovementAction.parse(json['action']),
    actionKey: json['actionKey'] is String ? json['actionKey'] as String : null,
    reason: json['reason'] is String ? json['reason'] as String : null,
    createdAt:
        DateTime.tryParse(_string(json['createdAt'])) ??
        DateTime.fromMillisecondsSinceEpoch(0),
  );
}

class MovementPage {
  const MovementPage({
    required this.currency,
    required this.items,
    required this.nextCursor,
  });

  final String currency;
  final List<Movement> items;
  final String? nextCursor;
}

/// Claves estables del catálogo de acciones del trabajador.
abstract final class ActionKeys {
  static const applicationExtra = 'APPLICATION_EXTRA';
  static const applicationPriority = 'APPLICATION_PRIORITY';
  static const profileHighlight = 'PROFILE_HIGHLIGHT';
  static const profileComplete = 'PROFILE_COMPLETE';
  static const documentVerified = 'DOCUMENT_VERIFIED';
  static const invitationResponded = 'INVITATION_RESPONDED';
  static const referral = 'REFERRAL';
  static const welcomeBonus = 'WELCOME_BONUS';
}

class CatalogItem {
  const CatalogItem({
    required this.actionKey,
    required this.isCost,
    required this.amount,
    required this.freeMonthlyQuota,
    required this.freeRemaining,
    required this.refundWindowHours,
  });

  final String actionKey;
  final bool isCost;
  final int amount;
  final int freeMonthlyQuota;
  final int freeRemaining;
  final int? refundWindowHours;

  factory CatalogItem.fromJson(Map<String, dynamic> json) => CatalogItem(
    actionKey: _string(json['actionKey']),
    isCost: json['kind'] == 'COST',
    amount: _int(json['amount']),
    freeMonthlyQuota: _int(json['freeMonthlyQuota']),
    freeRemaining: _int(json['freeRemaining']),
    refundWindowHours: json['refundWindowHours'] is num
        ? (json['refundWindowHours'] as num).toInt()
        : null,
  );
}

class Catalog {
  const Catalog({required this.currency, required this.items});

  final String currency;
  final List<CatalogItem> items;

  List<CatalogItem> get costs =>
      items.where((item) => item.isCost).toList(growable: false);
}

class DocumentReward {
  const DocumentReward({
    required this.kind,
    required this.uploaded,
    required this.verified,
    required this.rewarded,
  });

  /// `CV` o `PROFILE_PHOTO`.
  final String kind;
  final bool uploaded;
  final bool verified;
  final bool rewarded;
}

class MonthlyLimit {
  const MonthlyLimit({
    required this.limit,
    required this.used,
    required this.remaining,
  });

  final int limit;
  final int used;
  final int remaining;

  static MonthlyLimit? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    return MonthlyLimit(
      limit: _int(map['limit']),
      used: _int(map['used']),
      remaining: _int(map['remaining']),
    );
  }
}

class RewardItem {
  const RewardItem({
    required this.actionKey,
    required this.amount,
    required this.repeatable,
    required this.earnedCount,
    required this.earnedAmount,
    required this.earned,
    required this.requiredSections,
    required this.missingSections,
    required this.documents,
    required this.monthly,
  });

  final String actionKey;
  final int amount;
  final bool repeatable;
  final int earnedCount;
  final int earnedAmount;

  /// `status == EARNED`: ya ganado y no se puede volver a ganar.
  final bool earned;

  /// Solo `PROFILE_COMPLETE`: las secciones del criterio y las que faltan.
  final List<String> requiredSections;
  final List<String> missingSections;

  /// Solo `DOCUMENT_VERIFIED`: estado informativo de cada documento.
  final List<DocumentReward> documents;

  /// `REFERRAL`: referidos premiados este mes.
  final MonthlyLimit? monthly;

  factory RewardItem.fromJson(Map<String, dynamic> json) => RewardItem(
    actionKey: _string(json['actionKey']),
    amount: _int(json['amount']),
    repeatable: json['repeatable'] == true,
    earnedCount: _int(json['earnedCount']),
    earnedAmount: _int(json['earnedAmount']),
    earned: json['status'] == 'EARNED',
    requiredSections: _list(json['requiredSections']).whereType<String>().toList(
      growable: false,
    ),
    missingSections: _list(json['missingSections']).whereType<String>().toList(
      growable: false,
    ),
    documents: _list(json['documents'])
        .whereType<Map>()
        .map(
          (value) => DocumentReward(
            kind: _string(value['kind']),
            uploaded: value['uploaded'] == true,
            verified: value['verified'] == true,
            rewarded: value['rewarded'] == true,
          ),
        )
        .toList(growable: false),
    monthly: MonthlyLimit.tryParse(json['monthly']),
  );
}

/// Premios del actor y los topes de premios de hoy y de este mes.
class Rewards {
  const Rewards({
    required this.currency,
    required this.items,
    required this.dailyCap,
    required this.monthlyCap,
  });

  final String currency;
  final List<RewardItem> items;
  final RewardCapUsage? dailyCap;
  final RewardCapUsage? monthlyCap;

  RewardItem? item(String actionKey) {
    for (final candidate in items) {
      if (candidate.actionKey == actionKey) return candidate;
    }
    return null;
  }
}

class RewardCapUsage {
  const RewardCapUsage({
    required this.limit,
    required this.earned,
    required this.remaining,
  });

  final int limit;
  final int earned;
  final int remaining;

  static RewardCapUsage? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    return RewardCapUsage(
      limit: _int(map['limit']),
      earned: _int(map['earned']),
      remaining: _int(map['remaining']),
    );
  }
}

Rewards rewardsFromJson(Map<String, dynamic> json) {
  final caps = _map(json['caps']);
  return Rewards(
    currency: _string(json['currency']),
    items: _list(json['items'])
        .whereType<Map>()
        .map((value) => RewardItem.fromJson(Map<String, dynamic>.from(value)))
        .toList(growable: false),
    dailyCap: RewardCapUsage.tryParse(caps['daily']),
    monthlyCap: RewardCapUsage.tryParse(caps['monthly']),
  );
}

enum QuoteReason {
  charge,
  freeQuota,
  alreadyRegistered,
  freeAction,
  unknown;

  static QuoteReason parse(Object? value) => switch (value) {
    'CHARGE' => charge,
    'FREE_QUOTA' => freeQuota,
    'ALREADY_REGISTERED' => alreadyRegistered,
    'FREE_ACTION' => freeAction,
    _ => unknown,
  };
}

class FreeQuota {
  const FreeQuota({
    required this.monthlyLimit,
    required this.used,
    required this.remaining,
  });

  final int monthlyLimit;
  final int used;
  final int remaining;

  static FreeQuota? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    return FreeQuota(
      monthlyLimit: _int(map['monthlyLimit']),
      used: _int(map['used']),
      remaining: _int(map['remaining']),
    );
  }
}

class DailyCap {
  const DailyCap({
    required this.limit,
    required this.spentToday,
    required this.remaining,
  });

  final int limit;
  final int spentToday;
  final int remaining;

  static DailyCap? tryParse(Object? json) {
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);
    return DailyCap(
      limit: _int(map['limit']),
      spentToday: _int(map['spentToday']),
      remaining: _int(map['remaining']),
    );
  }
}

/// Cotización sin efectos de una acción (`GET /currency/quote`).
class Quote {
  const Quote({
    required this.currency,
    required this.actionKey,
    required this.cost,
    required this.reason,
    required this.freeQuota,
    required this.balance,
    required this.sufficientBalance,
    required this.dailyCap,
    required this.withinDailyCap,
    required this.canExecute,
    required this.refundWindowHours,
  });

  final String currency;
  final String actionKey;
  final int cost;
  final QuoteReason reason;
  final FreeQuota? freeQuota;
  final int balance;
  final bool sufficientBalance;
  final DailyCap? dailyCap;
  final bool withinDailyCap;
  final bool canExecute;
  final int? refundWindowHours;

  /// Solo una acción con costo mayor que cero pide confirmación.
  bool get isFree => cost <= 0;

  factory Quote.fromJson(Map<String, dynamic> json) => Quote(
    currency: _string(json['currency']),
    actionKey: _string(json['actionKey']),
    cost: _int(json['cost']),
    reason: QuoteReason.parse(json['reason']),
    freeQuota: FreeQuota.tryParse(json['freeQuota']),
    balance: _int(json['balance']),
    sufficientBalance: json['sufficientBalance'] != false,
    dailyCap: DailyCap.tryParse(json['dailyCap']),
    withinDailyCap: json['withinDailyCap'] != false,
    canExecute: json['canExecute'] != false,
    refundWindowHours: json['refundWindowHours'] is num
        ? (json['refundWindowHours'] as num).toInt()
        : null,
  );
}

class Referral {
  const Referral({
    required this.code,
    required this.referred,
    required this.rewarded,
    required this.monthly,
  });

  final String code;
  final int referred;
  final int rewarded;
  final MonthlyLimit? monthly;

  factory Referral.fromJson(Map<String, dynamic> json) => Referral(
    code: _string(json['code']),
    referred: _int(json['referred']),
    rewarded: _int(json['rewarded']),
    monthly: MonthlyLimit.tryParse(json['monthly']),
  );
}

class HighlightResult {
  const HighlightResult({
    required this.highlightedUntil,
    required this.idempotent,
    required this.chargedAmount,
  });

  final DateTime? highlightedUntil;
  final bool idempotent;
  final int chargedAmount;

  factory HighlightResult.fromJson(Map<String, dynamic> json) =>
      HighlightResult(
        highlightedUntil: DateTime.tryParse(_string(json['highlightedUntil'])),
        idempotent: json['idempotent'] == true,
        chargedAmount: _int(json['chargedAmount']),
      );
}
