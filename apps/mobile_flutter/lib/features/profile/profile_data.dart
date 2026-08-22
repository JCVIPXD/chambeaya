class WorkerProfile {
  const WorkerProfile({
    required this.name,
    required this.role,
    required this.city,
    required this.score,
    required this.rating,
  });

  final String name;
  final String role;
  final String city;
  final int score;
  final double rating;
}

class ProfileStrength {
  const ProfileStrength({
    required this.label,
    required this.emphasis,
    required this.icon,
  });

  final String label;
  final String emphasis;
  final String icon;
}

class CertificatePreview {
  const CertificatePreview({required this.title, required this.year});

  final String title;
  final String year;
}

class Experience {
  const Experience({
    required this.company,
    required this.position,
    required this.period,
    required this.initial,
  });

  final String company;
  final String position;
  final String period;
  final String initial;
}

const workerProfile = WorkerProfile(
  name: 'Amanda González',
  role: 'Profesional en Servicio y Hospitalidad',
  city: 'Lima, Perú',
  score: 98,
  rating: 4.9,
);

String profileCompletionLabel(int score) {
  if (score >= 95) return 'Excelente';
  if (score >= 80) return 'Confiable';
  return 'En progreso';
}

const profileStrengths = [
  ProfileStrength(label: 'Experta en', emphasis: 'Atención', icon: 'person'),
  ProfileStrength(label: 'Puntualidad', emphasis: 'Perfecta', icon: 'schedule'),
  ProfileStrength(
    label: 'Manipulación',
    emphasis: 'de Alimentos',
    icon: 'verified',
  ),
];

const certificates = [
  CertificatePreview(title: 'Manipulación de Alimentos', year: '2024'),
  CertificatePreview(title: 'Atención al Cliente', year: '2023'),
  CertificatePreview(title: 'Primeros Auxilios', year: '2023'),
];

const experiences = [
  Experience(
    company: 'Restaurante La Mar',
    position: 'Mozo / Atención al Cliente',
    period: 'May 2024 - Presente',
    initial: 'R',
  ),
  Experience(
    company: 'Café del Cielo',
    position: 'Barista',
    period: 'Nov 2023 - Abr 2024',
    initial: 'C',
  ),
];
