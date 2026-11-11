import '../jobs/api_client.dart';
import 'wallet_models.dart';

/// Acceso del trabajador a su billetera de moneda virtual. Solo lectura y
/// cotización, salvo destacar el perfil (la única acción de moneda que no
/// pertenece a una postulación). La interfaz permite simular la API.
abstract interface class WalletRepository {
  Future<Balance> balance();

  Future<MovementPage> movements({String? cursor, int limit});

  Future<Catalog> catalog();

  Future<Rewards> rewards();

  /// Costo previo sin efectos. `targetId` es el puesto, la postulación o el
  /// perfil propio según la acción.
  Future<Quote> quote(String actionKey, {String? targetId});

  Future<Referral> referral();

  Future<HighlightResult> highlightProfile();
}

class HttpWalletRepository implements WalletRepository {
  HttpWalletRepository({required this.api});

  final ApiClient api;

  @override
  Future<Balance> balance() async =>
      Balance.fromJson(await api.getJson('/workers/currency/balance'));

  @override
  Future<MovementPage> movements({String? cursor, int limit = 20}) async {
    final json = await api.getJson(
      '/workers/currency/movements',
      query: {'limit': '$limit', 'cursor': ?cursor},
    );
    final items = json['items'];
    final next = json['nextCursor'];
    return MovementPage(
      currency: json['currency'] is String ? json['currency'] as String : '',
      items: (items is List ? items : const [])
          .whereType<Map>()
          .map((value) => Movement.fromJson(Map<String, dynamic>.from(value)))
          .toList(growable: false),
      nextCursor: next is String && next.isNotEmpty ? next : null,
    );
  }

  @override
  Future<Catalog> catalog() async {
    final json = await api.getJson('/workers/currency/catalog');
    final items = json['items'];
    return Catalog(
      currency: json['currency'] is String ? json['currency'] as String : '',
      items: (items is List ? items : const [])
          .whereType<Map>()
          .map((value) => CatalogItem.fromJson(Map<String, dynamic>.from(value)))
          .toList(growable: false),
    );
  }

  @override
  Future<Rewards> rewards() async =>
      rewardsFromJson(await api.getJson('/workers/currency/rewards'));

  @override
  Future<Quote> quote(String actionKey, {String? targetId}) async =>
      Quote.fromJson(
        await api.getJson(
          '/workers/currency/quote',
          query: {'actionKey': actionKey, 'targetId': ?targetId},
        ),
      );

  @override
  Future<Referral> referral() async =>
      Referral.fromJson(await api.getJson('/workers/me/referral'));

  @override
  Future<HighlightResult> highlightProfile() async => HighlightResult.fromJson(
    await api.postJson('/workers/me/profile/highlight'),
  );
}
