import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders learn react link', () => {
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  const stateElement = screen.getByText(/debug/i);
  expect(linkElement).toBeInTheDocument();
  expect(stateElement).toMatchSnapshot();
});
