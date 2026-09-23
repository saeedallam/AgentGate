import { Module } from '@nestjs/common';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}