import { Injectable } from '@nestjs/common';
import { RAIBITSERVERService } from '../raibitserver.service';

@Injectable()
export class UsageService {
  constructor(private readonly controlPlane: RAIBITSERVERService) {}

  usageMe(subject: Record<string, any>) { return this.controlPlane.usageMe(subject); }
}
