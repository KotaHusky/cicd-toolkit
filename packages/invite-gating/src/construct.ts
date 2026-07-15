import { Construct } from 'constructs';

export interface InviteGatingProps {
  // Full props added in Task 4
}

export class InviteGating extends Construct {
  constructor(scope: Construct, id: string, props: InviteGatingProps) {
    super(scope, id);
  }
}
