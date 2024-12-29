export function requiredRule(v) {
      if (typeof v === 'number') {
        v = String(v);
      }
      return !!v ? true : 'مينفعش تسيبه فاضي يكش تكتب بلوط أنت حر';
  };