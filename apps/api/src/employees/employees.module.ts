import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [AttendanceModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
})
export class EmployeesModule {}
