local base = import 'scheduler.jsonnet';

base {
  maximumMessageSizeBytes: 64 * 1024 * 1024,
}
