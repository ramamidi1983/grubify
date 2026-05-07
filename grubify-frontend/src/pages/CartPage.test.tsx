import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CartPage from './CartPage';
import { cartService } from '../services/api';

jest.mock('../services/api', () => ({
  cartService: {
    get: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
}));

const mockCart = {
  id: 1,
  userId: 'user123',
  items: [
    {
      id: 1,
      foodItemId: 1,
      foodItem: {
        id: 1,
        name: 'Burger',
        description: 'Tasty burger',
        price: 10,
        imageUrl: 'https://example.com/burger.jpg',
        category: 'Main',
        isVegetarian: false,
        isVegan: false,
        isSpicy: false,
        restaurantId: 1,
        isAvailable: true,
        preparationTime: 15,
      },
      quantity: 1,
      specialInstructions: '',
    },
  ],
  subTotal: 10,
  tax: 1,
  deliveryFee: 2,
  total: 13,
};

describe('CartPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (cartService.get as jest.Mock).mockResolvedValue(mockCart);
    (cartService.removeItem as jest.Mock).mockResolvedValue({ ...mockCart, items: [] });
    (cartService.clear as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows clear and remove cart controls for discoverability', async () => {
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('button', { name: /clear cart/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('calls remove cart API from visible control', async () => {
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(cartService.get).toHaveBeenCalledWith('user123'));

    await userEvent.click(await screen.findByRole('button', { name: /remove/i }));
    expect(cartService.removeItem).toHaveBeenCalledWith('user123', 1);
  });

  it('calls clear cart API from visible control', async () => {
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByRole('button', { name: /clear cart/i }));
    expect(cartService.clear).toHaveBeenCalledWith('user123');
  });
});
