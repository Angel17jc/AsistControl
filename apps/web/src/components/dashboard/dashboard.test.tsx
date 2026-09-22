import { render, screen } from '@testing-library/react';
import { CheckCircle2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { AttendanceComposition } from './AttendanceComposition';
import { KpiTile } from './KpiTile';

describe('KpiTile', () => {
  it('renders label, value and detail', () => {
    render(<KpiTile label="Presentes" value={97} icon={CheckCircle2} detail="de 105 con turno" />);
    expect(screen.getByText('Presentes')).toBeInTheDocument();
    expect(screen.getByText('97')).toBeInTheDocument();
    expect(screen.getByText('de 105 con turno')).toBeInTheDocument();
  });
});

describe('AttendanceComposition', () => {
  const attendance = { present: 97, late: 12, absent: 8, onLeave: 3, pendingArrival: 0 };

  it('lists every state with its count, so color is never the only cue', () => {
    render(<AttendanceComposition attendance={attendance} scheduled={108} />);
    expect(screen.getByText('A tiempo').nextSibling).toHaveTextContent('85');
    expect(screen.getByText('Atrasados').nextSibling).toHaveTextContent('12');
    expect(screen.getByText('Ausentes').nextSibling).toHaveTextContent('8');
    expect(screen.getByText('108 personas con turno hoy')).toBeInTheDocument();
  });

  it('describes the bar for screen readers', () => {
    render(<AttendanceComposition attendance={attendance} scheduled={108} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(expect.stringContaining('Atrasados: 12'));
  });
});
